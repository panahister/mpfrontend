import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createPresentationRealtime} from '../src/index.js';

test('tickets, scoped invalidations, replay rejection and authority revocation',async()=>{
  let role='customer',value=1,calls=0;
  const upstream=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.headers.cookie!=='test=opaque'){res.writeHead(401);res.end('{}');return;}if(req.url==='/context')res.end(JSON.stringify({subject:'one',tenant:'city-a',roles:[role],csrf:'csrf'}));else{calls++;res.end(JSON.stringify({value,privateField:'never-on-socket'}));}});
  await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
  const bff='http://127.0.0.1:'+(upstream.address() as {port:number}).port;
  const realtime=createPresentationRealtime({development:true,publicOrigin:'http://localhost:4401',bffOrigin:bff,resolve:(name,c)=>name==='orders'&&c.roles.includes('customer')?'/v1/orders':undefined});
  const server=createServer((req,res)=>{void realtime.handleHttp(req,res).then(handled=>{if(!handled){res.writeHead(404);res.end();}});});realtime.attach(server);
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address='127.0.0.1:'+(server.address() as {port:number}).port;
  const headers={origin:'http://localhost:4401',cookie:'test=opaque','x-csrf-token':'csrf'};
  const ticket=async()=>(await(await fetch('http://'+address+'/api/realtime/ticket',{method:'POST',headers})).json() as {ticket:string}).ticket;
  const frames:Record<string,unknown>[]=[];let ws:WebSocket|undefined,replay:WebSocket|undefined;
  try{
    assert.equal((await fetch('http://'+address+'/api/realtime/ticket',{method:'POST',headers:{...headers,origin:'https://other.example'}})).status,403);
    assert.equal((await fetch('http://'+address+'/api/realtime/ticket',{method:'POST',headers:{...headers,'x-csrf-token':'wrong'}})).status,403);
    assert.equal((await fetch('http://'+address+'/api/realtime/ticket',{method:'POST',headers:{...headers,cookie:'test=wrong'}})).status,401);
    const token=await ticket();ws=new WebSocket('ws://'+address+'/api/realtime',{headers});
    ws.on('message',raw=>frames.push(JSON.parse(raw.toString()) as Record<string,unknown>));
    await once(ws,'open');ws.send(JSON.stringify({v:1,type:'subscribe',ticket:token,resources:['orders']}));
    await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('INVALIDATION_TIMEOUT')),5000);ws!.on('message',()=>{if(frames.some(f=>f.type==='invalidate')){clearTimeout(timer);resolve();}});});
    assert.equal(frames[0]!.type,'ready');assert.ok(!JSON.stringify(frames).includes('never-on-socket'));assert.equal(calls,1);
    replay=new WebSocket('ws://'+address+'/api/realtime',{headers});await once(replay,'open');replay.send(JSON.stringify({v:1,type:'subscribe',ticket:token,resources:['orders']}));
    assert.equal((await once(replay,'close'))[0],4003);
    value++;role='support';assert.equal((await once(ws,'close'))[0],4003);assert.equal(calls,1);
  }finally{ws?.terminate();replay?.terminate();realtime.close();server.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise<void>(r=>server.close(()=>r())),new Promise<void>(r=>upstream.close(()=>r()))]);}
});

test('production refuses the polling development profile',()=>{
  const before=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{assert.throws(()=>createPresentationRealtime({publicOrigin:'http://localhost:1',bffOrigin:'http://localhost:2',resolve:()=>undefined,development:true}),/DURABLE_REALTIME_PROFILE_REQUIRED/);}
  finally{if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;}
});
