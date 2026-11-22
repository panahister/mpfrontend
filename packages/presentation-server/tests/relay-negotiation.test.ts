import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {createRelay} from '../src/relay.js';

/** A fake BFF that records what reaches it. */
async function fakeBff(handler:(req:IncomingMessage,res:ServerResponse)=>void){
  const server=createServer(handler);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'http://127.0.0.1:'+(server.address() as {port:number}).port,close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}
/** The Accept that reached the BFF for each Accept the browser sent; `null` sends none. */
async function acceptsSeen(values:readonly (string|null)[]){
  const seen:(string|undefined)[]=[];
  const bff=await fakeBff((req,res)=>{seen.push(req.headers.accept);res.writeHead(204);res.end();});
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/api',sessionCookie:'test_session'});
    for(const accept of values)await relay(new Request('http://app.test/api/detail',accept===null?{}:{headers:{accept}}),['detail']);
  }finally{await bff.close();}
  return seen;
}
// fetch sends `Accept: */*` when a request names none, so this is what the BFF sees when the relay forwards no Accept,
// as it did before the relay forwarded any.
const FETCH_DEFAULT_ACCEPT='*/*';

test('an explicit Accept reaches the BFF unchanged, a single media type or a list with weights',async()=>{
  const values=[
    'application/vnd.example.detail.v1+json',
    'application/vnd.example.detail.v1+json;q=0.9, application/json;q=0.5',
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  ];
  assert.deepEqual(await acceptsSeen(values),values);
});

test('no Accept stays no Accept, and an over-long or malformed Accept is not forwarded',async()=>{
  const vendor='application/vnd.example.detail.v1+json';
  const refused=[
    null,
    '',
    // Over-long: more than 1024 characters of otherwise valid media ranges.
    Array.from({length:40},(_,index)=>'application/vnd.example.item'+index+'+json').join(', '),
    vendor+';q=2',
    vendor+';q=0.5000',
    vendor+';q=abc',
    vendor+',,application/json',
    vendor+';',
    // A quoted parameter value is valid HTTP, but the relay does not read quoted strings, so it does not forward one.
    vendor+'; version="2"',
    'application/',
    'application',
    '/json',
    'not a media type',
    'application/json garbage',
  ];
  assert.equal(refused[2]!.length>1024,true);
  assert.deepEqual(await acceptsSeen(refused),refused.map(()=>FETCH_DEFAULT_ACCEPT));
});

test('the BFF\'s Vary is returned, and no other response header is newly returned',async()=>{
  const vendor='application/vnd.example.detail.v1+json';
  let vary:string|undefined='Accept, Accept-Language';
  const bff=await fakeBff((_req,res)=>{
    res.writeHead(200,{'content-type':vendor,'cache-control':'no-store','x-content-type-options':'nosniff','x-correlation-id':'correlation-1',
      ...(vary===undefined?{}:{vary}),'x-private':'not passed',server:'internal','access-control-allow-origin':'*','set-cookie':'tracker=1; Path=/'});
    res.end('{}');
  });
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/api',sessionCookie:'test_session'});
    const send=()=>relay(new Request('http://app.test/api/detail',{headers:{accept:vendor}}),['detail']);
    const typed=await send();
    assert.deepEqual([...typed.headers.keys()].sort(),['cache-control','content-type','vary','x-content-type-options','x-correlation-id']);
    assert.equal(typed.headers.get('vary'),'Accept, Accept-Language');
    assert.equal(typed.headers.get('content-type'),vendor);
    assert.equal(await typed.text(),'{}');
    vary=undefined;
    const plain=await send();
    assert.deepEqual([...plain.headers.keys()].sort(),['cache-control','content-type','x-content-type-options','x-correlation-id']);
    await plain.text();
  }finally{await bff.close();}
});
