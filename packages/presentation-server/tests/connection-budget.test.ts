import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {EventEmitter,once} from 'node:events';
import {WebSocket} from 'ws';
import {createPresentationRealtime} from '../src/index.js';
import {createMemoryConnectionBudget} from '../src/connection-budget.js';

test('memory fallback enforces session quota and ownership',async()=>{
  const budget=createMemoryConnectionBudget();
  assert.equal(await budget.reserve('one','a'),30000);
  assert.equal(await budget.reserve('one','b'),30000);
  assert.equal(await budget.reserve('one','c'),undefined);
  await budget.release('wrong','a');
  assert.equal(await budget.reserve('one','c'),undefined);
  assert.equal(await budget.renew('wrong','a'),undefined);
  await budget.release('one','a');
  assert.equal(await budget.reserve('one','c'),30000);
});

test('no ready or invalidation when a reserved lease is lost or its store fails', {timeout:10000},async t=>{
  const listen=async(server:Server)=>{await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as {port:number}).port;};
  const upstream=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url==='/context'?{subject:'one',tenant:null,roles:['customer'],csrf:'csrf'}:{private:'never-in-frame'}));});
  const bffOrigin=await listen(upstream);
  try{
    for(const unavailable of [false,true])await t.test(unavailable?'store outage':'expired ownership',async()=>{
      let released=0;
      const releaseEvents=new EventEmitter();
      const runtime=createPresentationRealtime({development:true,publicOrigin:'http://localhost:4401',bffOrigin,resolve:()=>'/v1/orders',connectionBudget:{
        reserve:async()=>30000,renew:async()=>{if(unavailable)throw new Error('outage');return undefined;},release:async()=>{released++;releaseEvents.emit('released');}
      }});
      const server=createServer((req,res)=>{void runtime.handleHttp(req,res);});runtime.attach(server);
      const base=await listen(server),headers={origin:'http://localhost:4401',cookie:'one=opaque','x-csrf-token':'csrf'};
      let ws:WebSocket|undefined;
      try{
        const response=await fetch(base+'/api/realtime/ticket',{method:'POST',headers});assert.equal(response.status,200);
        const ticket=(await response.json() as {ticket:string}).ticket;
        ws=new WebSocket(base.replace('http:','ws:')+'/api/realtime',{headers});
        const frames:string[]=[];ws.on('message',raw=>frames.push(raw.toString()));await once(ws,'open');
        const closed=once(ws,'close');ws.send(JSON.stringify({v:1,type:'subscribe',ticket,resources:['orders']}));
        assert.equal((await closed)[0],unavailable?1013:4004);assert.deepEqual(frames,[]);
        // The client's close precedes the server's close listener; server.close() does not await
        // upgraded sockets. Observe the actual release, not the HTTP server lifecycle.
        if(released===0)await once(releaseEvents,'released',{signal:AbortSignal.timeout(2000)});
      }finally{ws?.terminate();runtime.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
      assert.equal(released,1);
    });
  }finally{upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));}
});
