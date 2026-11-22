import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingHttpHeaders,type IncomingMessage,type ServerResponse} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff,type ApiRoute,type NegotiatedJsonRoute,type StreamPolicy} from '../src/index.js';

const vendor='application/vnd.example.detail.v1+json',summary='application/vnd.example.summary.v1+json',unlisted='application/vnd.example.other.v1+json';
const publicOrigin='http://localhost:4401';
// fetch sends `Accept: */*` when a request names none, so this is what the upstream sees when the BFF sends no Accept,
// as it did before any route could negotiate.
const FETCH_DEFAULT_ACCEPT='*/*';
const download:StreamPolicy={responseTypes:['application/octet-stream'],responseHeaders:['content-type','content-length'],
  idleTimeoutMs:5000,totalTimeoutMs:60000,sessionCheckMs:1000};

type Answer={status?:number;headers?:Record<string,string>;body?:string};
/**
 * An identity provider, an upstream API that records each call and answers what the test sets, and a BFF over both with a
 * signed-in session: two negotiated routes, an ordinary JSON route, a streamed route and an in-process route.
 */
async function harness(){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';
  const jwt=(aud:string,extra:Record<string,unknown>={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer((req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]}));return;}
    if(req.url?.endsWith('/token')){res.end(JSON.stringify({access_token:jwt('api'),refresh_token:'server-only-refresh',id_token:jwt('web',{nonce})}));return;}
    res.end('{}');
  });
  const calls:IncomingHttpHeaders[]=[];
  let answer:Answer={};
  const upstream=createServer(async(req:IncomingMessage,res:ServerResponse)=>{
    for await(const chunk of req)void chunk;
    calls.push(req.headers);
    res.writeHead(answer.status??200,answer.headers??{'content-type':'application/json'});res.end(answer.body??'{"answer":true}');
  });
  for(const server of [provider,upstream])await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  issuer='http://127.0.0.1:'+(provider.address() as {port:number}).port+'/realms/test';
  const origin='http://127.0.0.1:'+(upstream.address() as {port:number}).port;
  const invoked:Readonly<Record<string,string>>[]=[];
  const detail:NegotiatedJsonRoute={method:'GET',pattern:/^\/v1\/detail$/,origin,negotiatedJson:[vendor,summary]};
  const write:NegotiatedJsonRoute={method:'POST',pattern:/^\/v1\/write$/,origin,negotiatedJson:[vendor]};
  const routes:ApiRoute[]=[detail,write,
    {method:'GET',pattern:/^\/v1\/legacy$/,origin},
    {method:'GET',pattern:/^\/v1\/files\/[a-z]+$/,origin,stream:download},
    {method:'POST',pattern:/^\/v1\/adapter$/,origin,invoke:async input=>{invoked.push(input.headers);return {status:200,body:{invoked:true}};}},
  ];
  const settings={publicOrigin,issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true as const};
  const bff=createServer(createBff({...settings,routes}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const login=await fetch(base+'/login',{redirect:'manual'}),location=new URL(login.headers.get('location')!);
  nonce=location.searchParams.get('nonce')!;
  const callback=await fetch(base+'/callback?code=ok&state='+location.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
  assert.equal(callback.status,303);
  const cookie=callback.headers.getSetCookie()[0]!.split(';')[0]!;
  const csrf=(await (await fetch(base+'/context',{headers:{cookie}})).json() as {csrf:string}).csrf;
  return {
    settings,origin,calls,invoked,
    answer:(next:Answer)=>{answer=next;},
    get:(path:string,accept?:string)=>fetch(base+path,{headers:{cookie,...(accept===undefined?{}:{accept})}}),
    post:(path:string,accept:string)=>fetch(base+path,{method:'POST',headers:{cookie,accept,origin:publicOrigin,'content-type':'application/json','x-csrf-token':csrf},body:'{}'}),
    /** The Accept the upstream saw on its last call. */
    lastAccept:()=>calls.at(-1)?.accept,
    close:async()=>{
      for(const server of [bff,provider,upstream])server.closeAllConnections();
      await Promise.all([bff,provider,upstream].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
    },
  };
}
/** A response's headers without Date, which changes each second, and with the opaque correlation id replaced. */
function headersOf(response:Response){
  return [...response.headers.entries()].filter(([name])=>name!=='date')
    .map(([name,value])=>[name,name==='x-correlation-id'&&/^[A-Za-z0-9_-]{43}$/.test(value)?'<opaque>':value]);
}

test('on a negotiated route a listed type with q>0 is sent upstream as Accept; q=0, an unlisted type and an invalid Accept are not',async()=>{
  const bff=await harness();
  try{
    const sent=async(accept:string|undefined)=>{await (await bff.get('/v1/detail',accept)).text();return bff.lastAccept();};
    assert.equal(await sent(vendor),vendor);
    assert.equal(await sent('text/html, '+vendor+';q=0.4'),vendor,'another range in the list does not hide a listed one');
    assert.equal(await sent('Application/Vnd.Example.Detail.V1+JSON'),vendor,'a media type is matched without case and sent as listed');
    assert.equal(await sent(vendor+';q=0.5, '+summary+';q=0.8'),summary,'the higher weight wins');
    assert.equal(await sent(vendor+';q=0.8, '+summary+';q=0.8'),vendor,'an equal weight keeps the order of the Accept');
    for(const accept of [undefined,vendor+';q=0',vendor+';q=0.000',unlisted,'application/json','*/*','application/*',
      vendor+';q=0, '+vendor,vendor+';version=2',vendor+';q=2',vendor+',,'+summary,
      Array.from({length:40},(_,index)=>'application/vnd.example.item'+index+'+json').join(', ')+', '+vendor])
      assert.equal(await sent(accept),FETCH_DEFAULT_ACCEPT,String(accept));
  }finally{await bff.close();}
});

test('a negotiated answer keeps the sent type with Vary and no-store; JSON stays JSON; a 200 of another type is refused',async()=>{
  const bff=await harness();
  try{
    bff.answer({headers:{'content-type':vendor+'; charset=utf-8','x-private':'not passed'},body:'{"view":"detail"}'});
    const typed=await bff.get('/v1/detail',vendor);
    assert.equal(typed.status,200);
    assert.deepEqual(headersOf(typed).filter(([name])=>!['connection','keep-alive','transfer-encoding'].includes(name!)),[
      ['cache-control','no-store'],['content-type',vendor],['vary','Accept, Accept-Language'],['x-content-type-options','nosniff'],['x-correlation-id','<opaque>']]);
    assert.equal(await typed.text(),'{"view":"detail"}','the body passes unchanged');

    bff.answer({headers:{'content-type':vendor}});
    const written=await bff.post('/v1/write',vendor);
    assert.equal(written.status,200);
    assert.equal(written.headers.get('content-type'),vendor);
    assert.equal(written.headers.get('vary'),'Accept, Accept-Language');
    assert.equal(written.headers.get('cache-control'),'no-store');
    await written.text();

    bff.answer({headers:{'content-type':'application/json'}});
    const json=await bff.get('/v1/detail',vendor);
    assert.equal(json.headers.get('content-type'),'application/json');
    assert.equal(json.headers.get('vary'),null);
    assert.equal(json.headers.get('cache-control'),'no-store');
    await json.text();

    // An answer of an error status is relabelled JSON, as on every ordinary route.
    bff.answer({status:404,headers:{'content-type':'application/problem+json'},body:'{"status":404}'});
    const missing=await bff.get('/v1/detail',vendor);
    assert.equal(missing.status,404);
    assert.equal(missing.headers.get('content-type'),'application/json');
    assert.equal(missing.headers.get('vary'),null);
    await missing.text();

    // A 200 that is neither the sent type nor JSON is refused whole: another listed type, an unlisted one, HTML, or a
    // listed type when none was asked for.
    for(const [accept,type] of [[vendor,summary],[vendor,unlisted],[vendor,'text/html'],[undefined,vendor]] as const){
      bff.answer({headers:{'content-type':type},body:'<p>not passed</p>'});
      const refused=await bff.get('/v1/detail',accept);
      assert.equal(refused.status,502,type);
      assert.equal(refused.headers.get('content-type'),'application/json');
      assert.deepEqual(await refused.json(),{type:'about:blank',status:502,title:'UPSTREAM_MEDIA_TYPE_REJECTED'});
    }
  }finally{await bff.close();}
});

test('a route without negotiatedJson, a streamed route and an in-process route are unchanged by any Accept',async()=>{
  const bff=await harness();
  try{
    // The exact headers of 1.1.0: the upstream's type is relabelled JSON, and no Vary is added.
    bff.answer({headers:{'content-type':vendor},body:'{"legacy":true}'});
    const legacy=await bff.get('/v1/legacy',vendor);
    assert.equal(bff.lastAccept(),FETCH_DEFAULT_ACCEPT);
    assert.equal(legacy.status,200);
    assert.deepEqual(headersOf(legacy),[['cache-control','no-store'],['connection','keep-alive'],['content-type','application/json'],
      ['keep-alive','timeout=5'],['transfer-encoding','chunked'],['x-content-type-options','nosniff'],['x-correlation-id','<opaque>']]);
    assert.equal(await legacy.text(),'{"legacy":true}');

    bff.answer({headers:{'content-type':'application/octet-stream'},body:'bytes'});
    const streamed=await bff.get('/v1/files/report',vendor);
    assert.equal(bff.lastAccept(),FETCH_DEFAULT_ACCEPT);
    assert.equal(streamed.headers.get('content-type'),'application/octet-stream');
    assert.equal(streamed.headers.get('vary'),null);
    assert.equal(await streamed.text(),'bytes');

    const invoked=await bff.post('/v1/adapter',vendor);
    assert.deepEqual(await invoked.json(),{invoked:true});
    assert.deepEqual(Object.keys(bff.invoked.at(-1)!),['authorization','Accept-Language','X-Correlation-ID','content-type']);
    assert.equal(invoked.headers.get('vary'),null);
  }finally{await bff.close();}
});

test('startup refuses an invalid negotiatedJson, and the field on a streamed or an in-process route',async()=>{
  const bff=await harness();
  try{
    const route={method:'GET',pattern:/^\/v1\/detail$/,origin:bff.origin};
    const start=(extra:Record<string,unknown>)=>createBff({...bff.settings,routes:[{...route,...extra} as ApiRoute]});
    const refusals:Record<string,Record<string,unknown>>={
      'an empty list':{negotiatedJson:[]},
      'more than 8':{negotiatedJson:Array.from({length:9},(_,index)=>'application/vnd.example.v'+index+'+json')},
      'a duplicate':{negotiatedJson:[vendor,vendor]},
      'a non-string':{negotiatedJson:[vendor,42]},
      'not a list':{negotiatedJson:vendor},
      'not application/*+json':{negotiatedJson:['text/vnd.example+json']},
      'no +json suffix':{negotiatedJson:['application/json']},
      'another suffix':{negotiatedJson:['application/vnd.example+xml']},
      'upper case':{negotiatedJson:['application/vnd.Example+json']},
      'a parameter':{negotiatedJson:[vendor+';charset=utf-8']},
      'text/html':{negotiatedJson:['text/html']},
      'a streamed route':{negotiatedJson:[vendor],stream:download},
      'an in-process route':{method:'POST',negotiatedJson:[vendor],invoke:async()=>({status:200,body:{}})},
    };
    for(const [name,extra] of Object.entries(refusals))assert.throws(()=>start(extra),/^Error: INVALID_ROUTE_NEGOTIATED_JSON$/,name);
    // Eight distinct types are the most a route may list; an absent field is a route without negotiation.
    assert.doesNotThrow(()=>start({negotiatedJson:Array.from({length:8},(_,index)=>'application/vnd.example.v'+index+'+json')}));
    assert.doesNotThrow(()=>start({negotiatedJson:undefined}));
  }finally{await bff.close();}
});
