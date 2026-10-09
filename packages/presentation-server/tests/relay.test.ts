import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingHttpHeaders,type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {createRelay} from '../src/relay.js';

const MB=1024*1024;
/** Every byte value from 0 to 255, repeated to `size` bytes. */
const pattern=(size:number)=>{const bytes=Buffer.alloc(size);for(let index=0;index<size;index++)bytes[index]=index%256;return bytes;};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function signal(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
/** Resolves with the promise, or fails after `ms`; the timer never outlives the wait. */
async function within<T>(promise:Promise<T>,ms:number,message:string){
  let timer:NodeJS.Timeout|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new assert.AssertionError({message})),ms);})]);}
  finally{clearTimeout(timer);}
}

/** A fake BFF that records what reaches it. */
async function fakeBff(handler:(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>){
  const server=createServer((req,res)=>{void Promise.resolve(handler(req,res)).catch(()=>undefined);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'http://127.0.0.1:'+(server.address() as {port:number}).port,close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})};
}

test('an upload of several megabytes streams to the BFF, which sees only what it checks and the content headers', async () => {
  const size=8*MB,body=pattern(size),firstByte=signal();
  const received:Buffer[]=[];
  let seen:IncomingHttpHeaders={},url='',producedBeforeFirstByte=0,produced=0;
  const bff=await fakeBff(async(req,res)=>{
    seen=req.headers;url=req.url??'';
    for await(const chunk of req){if(!received.length){producedBeforeFirstByte=produced;firstByte.resolve();}received.push(chunk as Buffer);}
    res.writeHead(201,{'content-type':'application/json','x-correlation-id':'correlation-1','x-content-type-options':'nosniff','cache-control':'no-store',
      'set-cookie':['test_session=rotated; HttpOnly; Path=/','tracker=1; Path=/'],'x-internal':'upstream detail',server:'internal'});
    res.end(JSON.stringify({received:received.reduce((sum,chunk)=>sum+chunk.length,0)}));
  });
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/transfer',sessionCookie:'test_session'});
    // The client produces 1 MiB, then waits until the BFF has bytes, then produces the rest: a relay that held
    // the whole body would never let the BFF see a byte, and the upload would not finish.
    let offset=0;
    const stream=new ReadableStream<Uint8Array>({async pull(controller){
      if(offset===MB)await firstByte.promise;
      if(offset>=size){controller.close();return;}
      const chunk=body.subarray(offset,offset+65536);offset+=chunk.length;produced=offset;controller.enqueue(new Uint8Array(chunk));
    }},{highWaterMark:0});
    const request=new Request('http://app.test/api/transfer/files/report?version=2',{method:'PUT',body:stream,duplex:'half',headers:{
      cookie:'tracker=1; test_session=opaque-session; brand=neutral',origin:'http://app.test','x-csrf-token':'csrf-1','idempotency-key':'upload-12345678',
      'accept-language':'en','content-type':'application/octet-stream','content-length':String(size),
      authorization:'Bearer from-the-browser','x-forwarded-for':'203.0.113.9','x-custom':'not forwarded'}} as RequestInit);
    const response=await relay(request,['files','report']);
    assert.equal(response.status,201);
    assert.deepEqual(await response.json(),{received:size});
    assert.equal(digest(Buffer.concat(received)),digest(body),'the bytes arrive unchanged');
    assert.ok(producedBeforeFirstByte<size,'the BFF received bytes before the client produced the last one');
    assert.equal(url,'/web/transfer/files/report?version=2');
    assert.equal(seen.cookie,'test_session=opaque-session','only the session cookie is forwarded');
    for(const [name,value] of Object.entries({origin:'http://app.test','x-csrf-token':'csrf-1','idempotency-key':'upload-12345678','accept-language':'en','content-type':'application/octet-stream','content-length':String(size)}))
      assert.equal(seen[name],value,name);
    for(const name of ['authorization','x-forwarded-for','x-custom'])assert.equal(seen[name],undefined,name);
    assert.deepEqual(response.headers.getSetCookie(),['test_session=rotated; HttpOnly; Path=/'],'no other cookie is passed back');
    assert.equal(response.headers.get('x-internal'),null);assert.equal(response.headers.get('server'),null);
    assert.equal(response.headers.get('x-correlation-id'),'correlation-1');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  }finally{await bff.close();}
});

test('a download of several megabytes streams back with its content headers only', async () => {
  const size=8*MB+13,body=pattern(size),clientHasBytes=signal();
  const bff=await fakeBff(async(_req,res)=>{
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(size),'content-disposition':'attachment; filename="report.bin"',
      'x-internal':'upstream detail','set-cookie':'tracker=1; Path=/','x-content-type-options':'nosniff','cache-control':'no-store'});
    res.write(body.subarray(0,65536));
    // The rest is sent only once the client holds the first bytes: the relay passes the answer as it arrives.
    await clientHasBytes.promise;
    res.end(body.subarray(65536));
  });
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/transfer',sessionCookie:'test_session'});
    const response=await relay(new Request('http://app.test/api/transfer/files/report',{headers:{cookie:'test_session=opaque-session'}}),['files','report']);
    assert.equal(response.status,200);
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];
    for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);clientHasBytes.resolve();}
    assert.equal(digest(Buffer.concat(chunks)),digest(body));
    assert.equal(response.headers.get('content-length'),String(size));
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    assert.equal(response.headers.get('content-disposition'),'attachment; filename="report.bin"');
    assert.equal(response.headers.get('x-internal'),null);
    assert.deepEqual(response.headers.getSetCookie(),[]);
  }finally{await bff.close();}
});

test('a client that goes away ends the call to the BFF', async () => {
  const ended=signal();let completed=false;
  const bff=await fakeBff(async(req,res)=>{
    req.on('close',()=>{if(!req.complete)ended.resolve();});
    for await(const chunk of req)void chunk;
    completed=true;res.end();
  });
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/transfer',sessionCookie:'test_session'});
    const controller=new AbortController();let sent=0;
    const stream=new ReadableStream<Uint8Array>({async pull(stream){
      if(sent===MB){controller.abort();return;}
      sent+=65536;stream.enqueue(new Uint8Array(65536));
    }},{highWaterMark:0});
    const call=relay(new Request('http://app.test/api/transfer/files/report',{method:'PUT',body:stream,duplex:'half',signal:controller.signal,
      headers:{'content-type':'application/octet-stream','content-length':String(8*MB)}} as RequestInit),['files','report']);
    await within(ended.promise,5000,'the BFF call did not end');
    await call.catch(()=>undefined);
    assert.equal(completed,false);
  }finally{await bff.close();}
});

test('a path segment cannot leave the base path, and the relay refuses an unsafe configuration', async () => {
  const paths:string[]=[];
  const bff=await fakeBff((req,res)=>{paths.push(req.url??'');res.writeHead(204);res.end();});
  try{
    const relay=createRelay({bffOrigin:bff.origin,basePath:'/web/transfer',sessionCookie:'test_session'});
    for(const segments of [[],['..','admin'],['.'],['files','']])assert.equal((await relay(new Request('http://app.test/x'),segments)).status,404,segments.join('/'));
    assert.deepEqual(paths,[],'a refused path never reaches the BFF');
    assert.equal((await relay(new Request('http://app.test/x'),['a b','c/../d'])).status,204);
    assert.deepEqual(paths,['/web/transfer/a%20b/c%2F..%2Fd']);
  }finally{await bff.close();}
  assert.throws(()=>createRelay({bffOrigin:'http://bff.test/path',basePath:'/web',sessionCookie:'s_id'}),/INVALID_ORIGIN/);
  for(const basePath of ['web','/web/../admin','/web/','/a b'])assert.throws(()=>createRelay({bffOrigin:'http://bff.test',basePath,sessionCookie:'s_id'}),/INVALID_RELAY_PATH/,basePath);
  assert.throws(()=>createRelay({bffOrigin:'http://bff.test',basePath:'/web',sessionCookie:'a=b'}),/INVALID_SESSION_COOKIE/);
});
