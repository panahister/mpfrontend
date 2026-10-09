import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request,type IncomingHttpHeaders,type IncomingMessage,type ServerResponse,type ClientRequest} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createRelay} from '@mpfrontend/presentation-server/relay';
import {createBff,type ApiRoute,type BffConfig,type StreamPolicy} from '../src/index.js';
import {createMemorySessionVault,type SessionVault} from '../src/session-store.js';

const MB=1024*1024,KB=1024;
const publicOrigin='http://localhost:4401';
/** Every byte value from 0 to 255, repeated to `size` bytes. */
const pattern=(size:number)=>{const bytes=Buffer.alloc(size);for(let index=0;index<size;index++)bytes[index]=index%256;return bytes;};
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function signal(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
/** The promise's value, or an assertion failure after `ms`: a missing event fails the test, never hangs it. */
async function within<T>(promise:Promise<T>,ms:number,message:string){
  let timer:NodeJS.Timeout|undefined;
  try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new assert.AssertionError({message})),ms);})]);}
  finally{clearTimeout(timer);}
}
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

const upload:StreamPolicy={requestTypes:['application/octet-stream','image/png'],maxRequestBytes:64*MB,responseTypes:['application/json'],responseHeaders:['content-type'],
  idleTimeoutMs:5000,totalTimeoutMs:60000,sessionCheckMs:50};
const download:StreamPolicy={responseTypes:['application/octet-stream'],responseHeaders:['content-type','content-length','content-disposition'],
  idleTimeoutMs:5000,totalTimeoutMs:60000,sessionCheckMs:50};

type Upstream=(req:IncomingMessage,res:ServerResponse)=>void|Promise<void>;
type Call={method:string;url:string;headers:IncomingHttpHeaders;complete:boolean;ended:Promise<void>};

/**
 * An identity provider, a programmable upstream API and a BFF over both. The BFF's server records each
 * incoming request, so that a test can see how much of a body the BFF holds.
 */
async function harness(extra:Partial<BffConfig>={}){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';
  const jwt=(aud:string,claims:Record<string,unknown>)=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'idp'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,realm_access:{roles:['member']},...claims})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'idp',alg:'RS256',use:'sig'}]}));return;}
    for await(const chunk of req)void chunk;
    if(req.url?.endsWith('/token')){res.end(JSON.stringify({access_token:jwt('api',{}),refresh_token:'r',id_token:jwt('web',{nonce,auth_time:Math.floor(Date.now()/1000)})}));return;}
    res.end('{}');
  });
  const calls:Call[]=[];
  // By default the upstream reads the whole body, then answers.
  let handler:Upstream=async(req,res)=>{for await(const chunk of req)void chunk;res.writeHead(200,{'content-type':'application/json'});res.end('{}');};
  const upstream=createServer((req,res)=>{
    let complete=false;
    const ended=new Promise<void>(resolve=>req.on('close',()=>resolve()));
    const call:Call={method:req.method??'',url:req.url??'',headers:req.headers,get complete(){return complete;},ended};
    req.on('end',()=>{complete=true;});
    calls.push(call);
    void Promise.resolve(handler(req,res)).catch(()=>undefined);
  });
  for(const server of [provider,upstream])await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const origin='http://127.0.0.1:'+(upstream.address() as {port:number}).port;
  const routes:ApiRoute[]=[
    {method:'PUT',pattern:/^\/v1\/files\/[a-z]+$/,origin,stream:upload},
    {method:'GET',pattern:/^\/v1\/files\/[a-z]+$/,origin,stream:download},
    {method:'PUT',pattern:/^\/v1\/small$/,origin,stream:{...upload,maxRequestBytes:MB}},
    {method:'PUT',pattern:/^\/v1\/quiet$/,origin,stream:{...upload,sessionCheckMs:60000}},
    {method:'PUT',pattern:/^\/v1\/slow$/,origin,stream:{...upload,idleTimeoutMs:200,totalTimeoutMs:800}},
    {method:'GET',pattern:/^\/v1\/slow$/,origin,stream:{...download,idleTimeoutMs:200,totalTimeoutMs:800}},
    {method:'POST',pattern:/^\/v1\/admin$/,origin,roles:['admin'],stream:upload},
    {method:'POST',pattern:/^\/v1\/strong$/,origin,authentication:{acr:['strong']},stream:upload},
    {method:'POST',pattern:/^\/v1\/json$/,origin},
  ];
  const vault=createMemorySessionVault(),expired=new Set<string>();
  // The test can end a session's absolute lifetime while a body streams.
  const sessionVault:SessionVault={...vault,read:async<T>(kind:'session'|'transaction',id:string)=>{
    const record=await vault.read<T>(kind,id);
    return record&&kind==='session'&&expired.has(id)?{...record,value:{...record.value,absoluteExpires:Date.now()-1}}:record;
  }};
  const handle=createBff({publicOrigin,issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true,routes,acrValues:['strong'],sessionVault,...extra} as BffConfig);
  const inbound:IncomingMessage[]=[];
  const bff=createServer((req,res)=>{inbound.push(req);void handle(req,res);});
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const signIn=async()=>{
    const login=await fetch(base+'/login',{redirect:'manual'}),target=new URL(login.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    const callback=await fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
    const cookie=callback.headers.getSetCookie()[0]!.split(';')[0]!;
    const csrf=(await (await fetch(base+'/context',{headers:{cookie}})).json() as {csrf:string}).csrf;
    return {cookie,csrf,id:cookie.slice('test_session='.length)};
  };
  /** Opens a request whose body the test writes itself. */
  const open=(path:string,headers:Record<string,string>,method='PUT')=>{
    const client=request(base+path,{method,headers,agent:false});
    const response=new Promise<{status:number;headers:IncomingHttpHeaders;body:Buffer;complete:boolean}>((resolve,reject)=>{
      client.on('response',res=>{
        const chunks:Buffer[]=[];
        res.on('data',chunk=>chunks.push(chunk));
        res.on('end',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks),complete:res.complete}));
        res.on('error',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks),complete:false}));
        res.on('aborted',()=>resolve({status:res.statusCode!,headers:res.headers,body:Buffer.concat(chunks),complete:false}));
      });
      client.on('error',reject);
    });
    response.catch(()=>undefined);
    return {client,response};
  };
  const close=async()=>{for(const server of [bff,provider,upstream])server.closeAllConnections();await Promise.all([bff,provider,upstream].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));};
  return {base,calls,inbound,expired,signIn,open,close,setUpstream:(next:Upstream)=>{handler=next;}};
}
/** Writes one chunk and waits while the connection asks the writer to wait. */
const send=(client:ClientRequest,chunk:Uint8Array)=>new Promise<void>((resolve,reject)=>{
  if(client.destroyed){reject(new Error('CLOSED'));return;}
  if(client.write(chunk)){resolve();return;}
  const drained=()=>{client.off('close',closed);resolve();};
  const closed=()=>{client.off('drain',drained);reject(new Error('CLOSED'));};
  client.once('drain',drained);client.once('close',closed);
});
const writeHeaders=(session:{cookie:string;csrf:string},extra:Record<string,string>={})=>({cookie:session.cookie,origin:publicOrigin,'x-csrf-token':session.csrf,...extra});

test('a stream policy is checked at startup, and nothing is filled in with a default',()=>{
  const base={publicOrigin,issuer:'http://127.0.0.1:1/realms/test',clientId:'web',audience:'api',cookieName:'test_session',development:true as const};
  const route=(method:string,stream:unknown,more:Partial<ApiRoute>={})=>({...base,routes:[{method,pattern:/^\/x$/,origin:'http://127.0.0.1:2',stream:stream as StreamPolicy,...more}]});
  const invalid=[
    route('PUT',{...upload,requestTypes:undefined}),route('PUT',{...upload,maxRequestBytes:undefined}),route('PUT',{...upload,maxRequestBytes:0}),
    route('PUT',{...upload,requestTypes:['*/*']}),route('PUT',{...upload,requestTypes:['application/octet-stream; q=1']}),route('PUT',{...upload,requestTypes:[]}),
    route('GET',{...download,requestTypes:['image/png']}),route('GET',{...download,responseTypes:[]}),
    route('GET',{...download,responseHeaders:['content-length']}),route('GET',{...download,responseHeaders:['content-type','set-cookie']}),
    route('GET',{...download,idleTimeoutMs:0}),route('GET',{...download,idleTimeoutMs:70000,totalTimeoutMs:60000}),route('GET',{...download,totalTimeoutMs:86400001}),
    route('GET',{...download,sessionCheckMs:undefined}),
    route('PUT',upload,{invoke:async()=>({status:200,body:{}})}),
  ];
  for(const config of invalid)assert.throws(()=>createBff(config as BffConfig),/INVALID_ROUTE_STREAM/,JSON.stringify(config.routes[0]!.stream));
  assert.equal(typeof createBff(route('PUT',upload)),'function');
  assert.equal(typeof createBff(route('GET',download)),'function');
});

test('a route without a stream keeps the JSON contract: 64 KiB, application/json and a JSON answer',async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    h.setUpstream((_req,res)=>{res.writeHead(200,{'content-type':'text/html','x-internal':'detail'});res.end('{"ok":true}');});
    const json=await fetch(h.base+'/v1/json',{method:'POST',headers:writeHeaders(session,{'content-type':'application/json'}),body:'{}'});
    assert.equal(json.status,200);assert.equal(json.headers.get('content-type'),'application/json');assert.equal(json.headers.get('x-internal'),null);
    const binary=await fetch(h.base+'/v1/json',{method:'POST',headers:writeHeaders(session,{'content-type':'application/octet-stream'}),body:'x'});
    assert.equal(binary.status,415);assert.equal(((await binary.json()) as {title:string}).title,'JSON_REQUIRED');
    const large=await fetch(h.base+'/v1/json',{method:'POST',headers:writeHeaders(session,{'content-type':'application/json'}),body:'"'+'x'.repeat(65536)+'"'});
    assert.equal(large.status,413);
    assert.equal(h.calls.length,1);
  }finally{await h.close();}
});

test('a streamed upload reaches the upstream as it arrives, unchanged, and the BFF holds a bounded window of it',{timeout:60000},async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    // Several megabytes: the upstream must see the first bytes before the client has sent the last one.
    const size=8*MB,body=pattern(size),firstByte=signal();
    const received:Buffer[]=[];
    h.setUpstream(async(req,res)=>{for await(const chunk of req){received.push(chunk as Buffer);firstByte.resolve();}res.writeHead(201,{'content-type':'application/json'});res.end('{"stored":true}');});
    const first=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(size)}));
    for(let offset=0;offset<MB;offset+=64*KB)await send(first.client,body.subarray(offset,offset+64*KB));
    await within(firstByte.promise,5000,'the upstream received nothing before the body was complete');
    for(let offset=MB;offset<size;offset+=64*KB)await send(first.client,body.subarray(offset,offset+64*KB));
    first.client.end();
    const answer=await first.response;
    assert.equal(answer.status,201);assert.equal(answer.body.toString(),'{"stored":true}');
    assert.equal(digest(Buffer.concat(received)),digest(body));

    // While the upstream reads nothing, the client can push no more than a bounded window into the BFF.
    const release=signal(),total=32*MB,chunk=Buffer.alloc(64*KB,7);let delivered=0;
    h.setUpstream(async(req,res)=>{await release.promise;for await(const part of req)delivered+=(part as Buffer).length;res.writeHead(201,{'content-type':'application/json'});res.end('{}');});
    const second=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(total)}));
    let written=0,largest=0;
    const sampler=setInterval(()=>{const req=h.inbound.at(-1)!;largest=Math.max(largest,req.readableLength+(req.socket?.readableLength??0));},2);
    try{
      while(written<total){
        if(second.client.write(chunk)){written+=chunk.length;continue;}
        written+=chunk.length;
        const drained=await Promise.race([new Promise<boolean>(resolve=>second.client.once('drain',()=>resolve(true))),pause(500).then(()=>false)]);
        if(!drained)break;
      }
    }finally{clearInterval(sampler);}
    assert.ok(written<total,'the client stalls while the upstream reads nothing ('+written+' of '+total+' bytes written)');
    assert.ok(largest<=256*KB,'the BFF buffered at most 256 KiB of the body (largest '+largest+' bytes)');
    release.resolve();
    while(written<total){await send(second.client,chunk);written+=chunk.length;}
    second.client.end();
    assert.equal((await second.response).status,201);
    assert.equal(delivered,total);
  }finally{await h.close();}
});

test('an oversize body or one without Content-Length is refused before any upstream call',async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    // Only the headers are sent: the refusal needs none of the body.
    const declared=h.open('/v1/small',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(MB+1)}));
    declared.client.flushHeaders();
    const tooLarge=await within(declared.response,5000,'no answer');
    assert.equal(tooLarge.status,413);assert.equal(JSON.parse(tooLarge.body.toString()).title,'BODY_TOO_LARGE');
    assert.equal(tooLarge.headers.connection,'close','the unread body is not read');
    declared.client.destroy();
    const chunked=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','transfer-encoding':'chunked'}));
    chunked.client.flushHeaders();
    const lengthRequired=await within(chunked.response,5000,'no answer');
    assert.equal(lengthRequired.status,411);assert.equal(JSON.parse(lengthRequired.body.toString()).title,'LENGTH_REQUIRED');
    chunked.client.destroy();
    const exact=h.open('/v1/small',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(MB)}));
    exact.client.end(Buffer.alloc(MB));
    assert.equal((await exact.response).status,200,'the maximum itself is accepted');
    assert.equal(h.calls.length,1);
  }finally{await h.close();}
});

test('a streamed request needs an accepted media type; the upstream gets the fixed headers and the content headers only',async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    for(const type of ['text/html','application/json','',undefined]){
      const call=h.open('/v1/files/report',writeHeaders(session,{...(type===undefined?{}:{'content-type':type}),'content-length':'4'}));
      call.client.end('data');
      const answer=await call.response;
      assert.equal(answer.status,415,String(type));assert.equal(JSON.parse(answer.body.toString()).title,'MEDIA_TYPE_NOT_ALLOWED');
    }
    assert.equal(h.calls.length,0);
    const streamed=h.open('/v1/files/report',writeHeaders(session,{'content-type':'Image/PNG; name=photo','content-length':'4','idempotency-key':'upload-key-1',
      'accept-language':'en','x-custom':'not forwarded','x-forwarded-for':'203.0.113.9'}));
    streamed.client.end('data');
    assert.equal((await streamed.response).status,200);
    const json=await fetch(h.base+'/v1/json',{method:'POST',headers:writeHeaders(session,{'content-type':'application/json','idempotency-key':'json-key-1','accept-language':'en'}),body:'data'});
    assert.equal(json.status,200);
    const [file,plain]=h.calls as [Call,Call];
    assert.equal(file.headers['content-type'],'Image/PNG; name=photo');assert.equal(file.headers['content-length'],'4');
    // The same header names as an ordinary route: today's fixed set with the content headers, and nothing else.
    assert.deepEqual(Object.keys(file.headers).sort(),Object.keys(plain.headers).sort());
    for(const name of ['cookie','origin','x-csrf-token','x-custom','x-forwarded-for'])assert.equal(file.headers[name],undefined,name);
    assert.ok(file.headers.authorization?.startsWith('Bearer '));
  }finally{await h.close();}
});

test('a streamed answer arrives as it is sent, byte for byte, with only the headers the route names',{timeout:60000},async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    const size=8*MB+13,body=pattern(size),clientHasBytes=signal();
    h.setUpstream(async(_req,res)=>{
      res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(size),'content-disposition':'attachment; filename="report.bin"',
        'content-security-policy':"default-src 'none'",'set-cookie':'upstream_session=1; Path=/','x-internal':'detail',server:'internal-server'});
      res.write(body.subarray(0,64*KB));
      await clientHasBytes.promise;
      res.end(body.subarray(64*KB));
    });
    const response=await fetch(h.base+'/v1/files/report',{headers:{cookie:session.cookie}});
    assert.equal(response.status,200);
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];
    for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);clientHasBytes.resolve();}
    assert.equal(digest(Buffer.concat(chunks)),digest(body),'every byte value arrives unchanged');
    assert.equal(response.headers.get('content-length'),String(size));
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    assert.equal(response.headers.get('content-disposition'),'attachment; filename="report.bin"');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('x-correlation-id')??'',/^[-_a-zA-Z0-9]{43}$/);
    assert.equal(response.headers.get('x-correlation-id'),h.calls[0]!.headers['x-correlation-id']);
    assert.deepEqual(response.headers.getSetCookie(),[]);
    for(const name of ['x-internal','server','content-security-policy'])assert.equal(response.headers.get(name),null,name);
    // An answer of a type the route does not list is refused, with none of its body.
    h.setUpstream((_req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end('<script>upstream secret</script>');});
    const refused=await fetch(h.base+'/v1/files/page',{headers:{cookie:session.cookie}});
    const text=await refused.text();
    assert.equal(refused.status,502);assert.equal(JSON.parse(text).title,'UPSTREAM_MEDIA_TYPE_REJECTED');assert.ok(!text.includes('secret'));
    h.setUpstream((_req,res)=>{res.writeHead(200);res.end('untyped');});
    assert.equal((await fetch(h.base+'/v1/files/untyped',{headers:{cookie:session.cookie}})).status,502,'an answer without a type is refused');
  }finally{await h.close();}
});

test('a client that cancels an upload or a download ends the upstream call',{timeout:30000},async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    const firstByte=signal();let answered=false;
    h.setUpstream(async(req,res)=>{try{for await(const chunk of req){void chunk;firstByte.resolve();}}catch{return;}answered=true;res.writeHead(201,{'content-type':'application/json'});res.end('{}');});
    const upload=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(8*MB)}));
    for(let offset=0;offset<MB;offset+=64*KB)await send(upload.client,Buffer.alloc(64*KB));
    await within(firstByte.promise,5000,'no upstream bytes');
    upload.client.destroy();
    await within(h.calls[0]!.ended,3000,'the upstream upload call was not ended');
    assert.equal(h.calls[0]!.complete,false,'the upload was aborted, not completed');assert.equal(answered,false);
    const downloadClosed=signal();let finished=false;
    h.setUpstream(async(_req,res)=>{
      res.on('close',()=>{if(!res.writableFinished)downloadClosed.resolve();else finished=true;});
      res.writeHead(200,{'content-type':'application/octet-stream'});
      while(!res.destroyed){res.write(Buffer.alloc(64*KB));await pause(20);}
    });
    const controller=new AbortController();
    const response=await fetch(h.base+'/v1/files/report',{headers:{cookie:session.cookie},signal:controller.signal});
    await response.body!.getReader().read();
    controller.abort();
    await within(downloadClosed.promise,3000,'the upstream download call was not ended');
    assert.equal(finished,false);
  }finally{await h.close();}
});

test('a session that ends while a body streams ends the transfer, and an ended session sends no byte upstream',{timeout:30000},async()=>{
  const h=await harness();
  try{
    // Logout from another request during an upload: the upstream call is aborted and the client gets no success.
    const session=await h.signIn();
    const firstByte=signal();
    h.setUpstream(async(req,res)=>{try{for await(const chunk of req){void chunk;firstByte.resolve();}}catch{return;}res.writeHead(201,{'content-type':'application/json'});res.end('{}');});
    const upload=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(8*MB)}));
    for(let offset=0;offset<MB;offset+=64*KB)await send(upload.client,Buffer.alloc(64*KB));
    await within(firstByte.promise,5000,'no upstream bytes');
    const logout=await fetch(h.base+'/logout',{method:'POST',headers:writeHeaders(session,{'content-type':'application/json'}),body:'{}'});
    assert.equal(logout.status,200);
    const ended=await within(upload.response,3000,'the transfer did not end');
    assert.equal(ended.status,401);assert.equal(JSON.parse(ended.body.toString()).title,'LOGIN_REQUIRED');
    await within(h.calls[0]!.ended,3000,'the upstream call was not ended');
    assert.equal(h.calls[0]!.complete,false);
    // The ended session is refused before anything goes upstream.
    const again=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':'4'}));
    again.client.end('data');
    assert.equal((await again.response).status,401);
    assert.equal(h.calls.length,1);

    // The session is read once more when the request body ends, even between two interval checks.
    const quiet=await h.signIn();
    const quietFirst=signal();
    h.setUpstream(async(req,res)=>{try{for await(const chunk of req){void chunk;quietFirst.resolve();}}catch{return;}res.writeHead(201,{'content-type':'application/json'});res.end('{}');});
    const late=h.open('/v1/quiet',writeHeaders(quiet,{'content-type':'application/octet-stream','content-length':String(2*MB)}));
    await send(late.client,Buffer.alloc(MB));
    await within(quietFirst.promise,5000,'no upstream bytes');
    await fetch(h.base+'/logout',{method:'POST',headers:writeHeaders(quiet,{'content-type':'application/json'}),body:'{}'});
    late.client.end(Buffer.alloc(MB));
    const lateAnswer=await within(late.response,3000,'the transfer did not end');
    assert.equal(lateAnswer.status,401);
    await within(h.calls[1]!.ended,3000,'the upstream call was not ended');
    assert.equal(h.calls[1]!.complete,false,'the upstream never saw the end of the body');

    // The absolute lifetime ends during a download: the answer has started, so its connection is cut.
    const reader=await h.signIn();
    const closed=signal();
    h.setUpstream(async(_req,res)=>{
      res.on('close',()=>closed.resolve());
      res.writeHead(200,{'content-type':'application/octet-stream'});
      while(!res.destroyed){res.write(Buffer.alloc(16*KB));await pause(20);}
    });
    const response=await fetch(h.base+'/v1/files/report',{headers:{cookie:reader.cookie}});
    const stream=response.body!.getReader();
    await stream.read();
    h.expired.add(reader.id);
    await within(closed.promise,3000,'the upstream download was not ended');
    await assert.rejects(async()=>{for(;;){const {done}=await stream.read();if(done)return;}},'the download does not complete');
  }finally{await h.close();}
});

test('an idle or overlong transfer ends the upstream call and answers 504 when no answer has started',{timeout:30000},async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    h.setUpstream(async(req,res)=>{try{for await(const chunk of req)void chunk;}catch{return;}res.writeHead(201,{'content-type':'application/json'});res.end('{}');});
    // Idle: the client stops sending.
    const idle=h.open('/v1/slow',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(MB)}));
    await send(idle.client,Buffer.alloc(64*KB));
    const idleStarted=Date.now();
    const idleAnswer=await within(idle.response,3000,'no answer');
    assert.equal(idleAnswer.status,504);
    assert.ok(Date.now()-idleStarted<700,'the idle timeout, before the total timeout, ended it');assert.equal(JSON.parse(idleAnswer.body.toString()).title,'UPSTREAM_TIMEOUT');
    await within(h.calls[0]!.ended,3000,'the idle upstream call was not ended');assert.equal(h.calls[0]!.complete,false);
    // Total: the client keeps sending, never idle, but the transfer lasts longer than the route allows.
    const long=h.open('/v1/slow',writeHeaders(session,{'content-type':'application/octet-stream','content-length':String(MB)}));
    const started=Date.now();let answer:{status:number}|undefined;
    void long.response.then(value=>{answer=value;});
    while(!answer&&Date.now()-started<3000){await send(long.client,Buffer.alloc(KB)).catch(()=>undefined);await pause(50);}
    assert.equal(answer?.status,504);
    assert.ok(Date.now()-started>=700,'the total timeout, not the idle timeout, ended it');
    await within(h.calls[1]!.ended,3000,'the long upstream call was not ended');
    // Total after the answer has started: the connection is cut.
    const cut=signal();
    h.setUpstream(async(_req,res)=>{res.on('close',()=>cut.resolve());res.writeHead(200,{'content-type':'application/octet-stream'});while(!res.destroyed){res.write(Buffer.alloc(KB));await pause(50);}});
    const response=await fetch(h.base+'/v1/slow',{headers:{cookie:session.cookie}});
    assert.equal(response.status,200);
    await assert.rejects(response.arrayBuffer(),'the answer is cut, never completed');
    await within(cut.promise,3000,'the upstream download was not ended');
  }finally{await h.close();}
});

test('every check of an ordinary route runs on a streamed route before any of its body is read',async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    const refuse=async(path:string,headers:Record<string,string>,method='PUT')=>{
      // Only the headers are sent, with a body declared: a refusal must not wait for any of it.
      const call=h.open(path,{'content-type':'application/octet-stream','content-length':String(MB),...headers},method);
      call.client.flushHeaders();
      const answer=await within(call.response,5000,'no answer for '+path);
      call.client.destroy();
      // A refused request for a streamed route closes its connection: the unread body is never read.
      if(path!=='/v1/other')assert.equal(answer.headers.connection,'close',path);
      return {status:answer.status,title:JSON.parse(answer.body.toString()).title as string};
    };
    assert.deepEqual(await refuse('/v1/files/report',{}),{status:401,title:'LOGIN_REQUIRED'});
    assert.deepEqual(await refuse('/v1/files/report',{cookie:session.cookie,origin:'https://evil.example','x-csrf-token':session.csrf}),{status:403,title:'CSRF_REJECTED'});
    assert.deepEqual(await refuse('/v1/files/report',{cookie:session.cookie,origin:publicOrigin}),{status:403,title:'CSRF_REJECTED'});
    assert.deepEqual(await refuse('/v1/files/report',{cookie:session.cookie,origin:publicOrigin,'x-csrf-token':'wrong'}),{status:403,title:'CSRF_REJECTED'});
    // A path outside the allowlist is not a streamed route, so today's order holds: JSON first, then 404.
    assert.deepEqual(await refuse('/v1/other',writeHeaders(session)),{status:415,title:'JSON_REQUIRED'});
    assert.deepEqual(await refuse('/v1/other',writeHeaders(session,{'content-type':'application/json'})),{status:404,title:'OPERATION_NOT_FOUND'});
    assert.deepEqual(await refuse('/v1/admin',writeHeaders(session),'POST'),{status:403,title:'FORBIDDEN'});
    assert.deepEqual(await refuse('/v1/files/report',writeHeaders(session,{'idempotency-key':'bad key'})),{status:400,title:'INVALID_IDEMPOTENCY_KEY'});
    assert.deepEqual(await refuse('/v1/strong',writeHeaders(session),'POST'),{status:401,title:'STEP_UP_REQUIRED'});
    assert.equal(h.calls.length,0,'no refused request reached the upstream');
    // An accepted request carries its idempotency key and the correlation id that the client gets back.
    const accepted=h.open('/v1/files/report',writeHeaders(session,{'content-type':'application/octet-stream','content-length':'4','idempotency-key':'upload-key-2'}));
    accepted.client.end('data');
    const answer=await accepted.response;
    assert.equal(answer.status,200);
    assert.equal(h.calls[0]!.headers['idempotency-key'],'upload-key-2');
    assert.equal(answer.headers['x-correlation-id'],h.calls[0]!.headers['x-correlation-id']);
    // An upstream step-up challenge on a streamed route becomes the same typed step-up.
    h.setUpstream((req,res)=>{req.resume();res.writeHead(401,{'www-authenticate':'Bearer error="insufficient_user_authentication", max_age="60"','content-type':'application/json'});res.end('{"detail":"upstream"}');});
    const challenged=await fetch(h.base+'/v1/files/report',{headers:{cookie:session.cookie}});
    const body=await challenged.json() as {title:string;stepUp:{maxAge:number}};
    assert.equal(challenged.status,401);assert.equal(body.title,'STEP_UP_REQUIRED');assert.equal(body.stepUp.maxAge,60);
  }finally{await h.close();}
});

test('the presentation relay carries a streamed route between a client and the BFF in both directions',{timeout:60000},async()=>{
  const h=await harness();
  try{
    const session=await h.signIn();
    const relay=createRelay({bffOrigin:h.base,basePath:'/v1',sessionCookie:'test_session'});
    const size=6*MB,body=pattern(size),firstByte=signal(),received:Buffer[]=[];
    h.setUpstream(async(req,res)=>{
      if(req.method==='GET'){res.writeHead(200,{'content-type':'application/octet-stream','content-length':String(size),'x-internal':'detail'});res.end(body);return;}
      for await(const chunk of req){received.push(chunk as Buffer);firstByte.resolve();}
      res.writeHead(201,{'content-type':'application/json'});res.end('{"stored":true}');
    });
    let offset=0,producedAtFirstByte=-1;
    void firstByte.promise.then(()=>{producedAtFirstByte=offset;});
    const stream=new ReadableStream<Uint8Array>({async pull(controller){
      if(offset===MB)await firstByte.promise;
      if(offset>=size){controller.close();return;}
      const chunk=body.subarray(offset,offset+64*KB);offset+=chunk.length;controller.enqueue(new Uint8Array(chunk));
    }},{highWaterMark:0});
    const uploaded=await relay(new Request('http://localhost:4401/api/transfer/files/report',{method:'PUT',body:stream,duplex:'half',
      headers:{cookie:'brand=neutral; '+session.cookie,origin:publicOrigin,'x-csrf-token':session.csrf,'content-type':'application/octet-stream','content-length':String(size)}} as RequestInit),['files','report']);
    assert.equal(uploaded.status,201);assert.deepEqual(await uploaded.json(),{stored:true});
    assert.equal(digest(Buffer.concat(received)),digest(body));
    assert.ok(producedAtFirstByte>=0&&producedAtFirstByte<size,'the upstream had bytes before the client produced the last one');
    const downloaded=await relay(new Request('http://localhost:4401/api/transfer/files/report',{headers:{cookie:session.cookie}}),['files','report']);
    assert.equal(downloaded.status,200);
    assert.equal(digest(new Uint8Array(await downloaded.arrayBuffer())),digest(body));
    assert.equal(downloaded.headers.get('x-internal'),null);assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
  }finally{await h.close();}
});
