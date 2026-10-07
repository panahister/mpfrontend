import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createPresentationRealtime,type AdmissionTicket,type AdmissionTicketStore} from '../src/index.js';

test('shared admission port: cross-replica use, replay, unavailable store and first-frame authority', {timeout:15000},async t=>{
  let role='customer',unavailable=false;
  const records=new Map<string,AdmissionTicket>();
  const store:AdmissionTicketStore={
    async issue(id,ticket){if(unavailable)throw new Error('unavailable');records.set(id,ticket);},
    async consume(id){if(unavailable)throw new Error('unavailable');const value=records.get(id);records.delete(id);return value;}
  };
  const upstream=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/context'?{subject:'one',tenant:null,roles:[role],csrf:'csrf'}:{private:'not-in-frame'}));});
  const listen=async(server:Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return '127.0.0.1:'+(server.address() as {port:number}).port;};
  const bffOrigin='http://'+await listen(upstream);
  const replicas=[0,1].map(()=>{
    const runtime=createPresentationRealtime({development:true,publicOrigin:'http://localhost:4401',bffOrigin,ticketStore:store,resolve:()=>'/v1/orders'});
    const server=createServer((req,res)=>{void runtime.handleHttp(req,res);});runtime.attach(server);return {runtime,server,address:''};
  });
  const headers={origin:'http://localhost:4401',cookie:'test=opaque','x-csrf-token':'csrf'};
  const sockets:WebSocket[]=[];
  const ticket=async()=>{
    const response=await fetch('http://'+replicas[0]!.address+'/api/realtime/ticket',{method:'POST',headers});
    assert.equal(response.status,200);return (await response.json() as {ticket:string}).ticket;
  };
  const connect=async(index:number)=>{const socket=new WebSocket('ws://'+replicas[index]!.address+'/api/realtime',{headers});sockets.push(socket);await once(socket,'open');return socket;};
  const subscribe=(socket:WebSocket,id:string)=>socket.send(JSON.stringify({v:1,type:'subscribe',ticket:id,resources:['orders']}));
  try{
    for(const replica of replicas)replica.address=await listen(replica.server);
    await t.test('ticket issued on one replica is consumed on another',async()=>{
      const id=await ticket(),socket=await connect(1),message=once(socket,'message');subscribe(socket,id);
      assert.equal(JSON.parse((await message)[0].toString()).type,'ready');socket.close();await once(socket,'close');
      const replay=await connect(0),closed=once(replay,'close');subscribe(replay,id);assert.equal((await closed)[0],4003);
    });
    await t.test('two replicas racing the same ticket admit only one connection',async()=>{
      const id=await ticket(),a=await connect(0),b=await connect(1);
      const outcome=(socket:WebSocket)=>new Promise<'ready'|'rejected'>(resolve=>{
        socket.on('message',raw=>{if(JSON.parse(raw.toString()).type==='ready')resolve('ready');});
        socket.on('close',()=>resolve('rejected'));
      });
      const results=[outcome(a),outcome(b)];subscribe(a,id);subscribe(b,id);
      assert.deepEqual((await Promise.all(results)).sort(),['ready','rejected']);
      for(const socket of [a,b])if(socket.readyState===WebSocket.OPEN){socket.close();await once(socket,'close');}
    });
    await t.test('unavailable store rejects issue and admission',async()=>{
      const id=await ticket();unavailable=true;
      assert.equal((await fetch('http://'+replicas[0]!.address+'/api/realtime/ticket',{method:'POST',headers})).status,503);
      const socket=await connect(1),closed=once(socket,'close');subscribe(socket,id);assert.equal((await closed)[0],4003);unavailable=false;
    });
    await t.test('authority changed after upgrade is rejected before ready or invalidation',async()=>{
      const id=await ticket(),socket=await connect(1),frames:unknown[]=[];socket.on('message',raw=>frames.push(raw.toString()));
      role='support';const closed=once(socket,'close');subscribe(socket,id);assert.equal((await closed)[0],4003);assert.deepEqual(frames,[]);
    });
  }finally{
    for(const socket of sockets)socket.terminate();
    for(const replica of replicas)replica.runtime.close();
    await Promise.all([upstream,...replicas.map(r=>r.server)].map(async server=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}));
  }
});
