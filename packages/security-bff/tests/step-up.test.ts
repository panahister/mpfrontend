import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingHttpHeaders} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff,type BffConfig} from '../src/index.js';

/** A provider whose next ID token carries the given acr and auth_time, an upstream API, and a BFF over both. */
async function harness(extra:Partial<BffConfig>={}){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';
  const next:{acr?:string;authTime?:number}={};
  const authorize:URLSearchParams[]=[],upstreamCalls:{method:string;headers:IncomingHttpHeaders}[]=[];
  let challenge:string|undefined;
  const jwt=(aud:string,extra:Record<string,unknown>)=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'idp'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'idp',alg:'RS256',use:'sig'}]}));return;}
    if(req.url?.endsWith('/token')){
      for await(const chunk of req)void chunk;
      const identity={nonce,auth_time:next.authTime??Math.floor(Date.now()/1000),...(next.acr?{acr:next.acr}:{})};
      res.end(JSON.stringify({access_token:jwt('api',{}),refresh_token:'r',id_token:jwt('web',identity)}));return;
    }
    if(req.url?.startsWith('/v1/')){
      for await(const chunk of req)void chunk;
      upstreamCalls.push({method:req.method??'',headers:req.headers});
      if(challenge){res.statusCode=401;res.setHeader('www-authenticate',challenge);res.setHeader('x-internal','provider-detail');res.end(JSON.stringify({detail:'upstream body'}));return;}
      res.end('{"ok":true}');return;
    }
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const routes=[
    {method:'GET',pattern:/^\/v1\/profile$/,origin:providerOrigin},
    {method:'GET',pattern:/^\/v1\/recent$/,origin:providerOrigin,authentication:{maxAge:300}},
    {method:'POST',pattern:/^\/v1\/transfer$/,origin:providerOrigin,authentication:{maxAge:300,acr:['strong']}},
  ];
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true,
    routes,acrValues:['strong'],returnPaths:['/',/^\/orders\/\d+$/],...extra} as BffConfig));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const signIn=async(query='',previous?:string)=>{
    const login=await fetch(base+'/login'+query,{redirect:'manual'});
    if(login.status!==302)return {status:login.status} as const;
    const target=new URL(login.headers.get('location')!);authorize.push(target.searchParams);
    nonce=target.searchParams.get('nonce')!;
    const callback=await fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!+(previous?'; '+previous:'')},redirect:'manual'});
    const set=callback.headers.getSetCookie()[0];
    return {status:callback.status,location:callback.headers.get('location'),cookie:set?.startsWith('test_session=')?set.split(';')[0]!:undefined};
  };
  const csrfOf=async(cookie:string)=>(await (await fetch(base+'/context',{headers:{cookie}})).json() as {csrf:string}).csrf;
  const call=async(cookie:string,path:string,init:{method?:string;key?:string}={})=>{
    const headers:Record<string,string>={cookie};
    if(init.method==='POST')Object.assign(headers,{origin:'http://localhost:4401','x-csrf-token':await csrfOf(cookie),'content-type':'application/json',...(init.key?{'idempotency-key':init.key}:{})});
    const response=await fetch(base+path,{method:init.method??'GET',headers,...(init.method==='POST'?{body:'{}'}:{})});
    return {status:response.status,headers:response.headers,text:await response.text()};
  };
  const close=async()=>{for(const server of [bff,provider])server.closeAllConnections();await Promise.all([bff,provider].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));};
  return {providerOrigin,next,authorize,upstreamCalls,setChallenge:(value?:string)=>{challenge=value;},signIn,call,close};
}

test('a route that needs a recent sign-in answers a typed step-up that never names the provider',async()=>{
  mock.timers.enable({apis:['Date'],now:Date.now()});
  const h=await harness();
  try{
    const {cookie}=await h.signIn();
    assert.equal((await h.call(cookie!,'/v1/recent')).status,200);
    mock.timers.tick(301000);
    const response=await h.call(cookie!,'/v1/recent');
    assert.equal(response.status,401);
    const body=JSON.parse(response.text) as {title:string;stepUp:Record<string,unknown>};
    assert.equal(body.title,'STEP_UP_REQUIRED');
    assert.deepEqual(body.stepUp,{maxAge:300,login:'/api/session/login?max_age=300',resubmit:'idempotent'});
    assert.ok(!response.text.includes(h.providerOrigin)&&!response.text.includes('127.0.0.1'));
    assert.equal((await h.call(cookie!,'/v1/profile')).status,200,'a route without a requirement is unaffected');
    assert.equal(h.upstreamCalls.filter(call=>call.method==='GET').length,2,'the stale request never reached the API');
  }finally{await h.close();mock.timers.reset();}
});

test('a step-up sends max_age and acr_values, checks auth_time and acr, replaces the weaker session and returns to an allowlisted path',async()=>{
  const h=await harness();
  try{
    const weak=await h.signIn();
    const write=await h.call(weak.cookie!,'/v1/transfer',{method:'POST',key:'transfer-key-1'});
    assert.equal(write.status,401);
    const challenge=(JSON.parse(write.text) as {stepUp:{login:string;acrValues:string[];resubmit:string}}).stepUp;
    assert.deepEqual(challenge.acrValues,['strong']);assert.equal(challenge.resubmit,'idempotent');
    h.next.acr='strong';
    const strong=await h.signIn(challenge.login.replace('/api/session/login','')+'&return_to=/orders/42',weak.cookie);
    const sent=h.authorize.at(-1)!;
    assert.equal(sent.get('max_age'),'300');assert.equal(sent.get('acr_values'),'strong');
    assert.equal(strong.status,303);assert.equal(strong.location,'http://localhost:4401/orders/42');
    assert.equal((await h.call(weak.cookie!,'/v1/profile')).status,401,'no token of the weaker session is kept');
    // The presentation server resubmits the held write with the same idempotency key; the BFF never replays it.
    const before=h.upstreamCalls.length;
    assert.equal((await h.call(strong.cookie!,'/v1/transfer',{method:'POST',key:'transfer-key-1'})).status,200);
    assert.equal(h.upstreamCalls.length,before+1);
    assert.equal(h.upstreamCalls.at(-1)!.headers['idempotency-key'],'transfer-key-1');
  }finally{await h.close();}
});

test('a write without an idempotency key is never resubmitted without the person',async()=>{
  const h=await harness();
  try{
    const {cookie}=await h.signIn();
    const response=await h.call(cookie!,'/v1/transfer',{method:'POST'});
    assert.equal(response.status,401);
    assert.equal((JSON.parse(response.text) as {stepUp:{resubmit:string}}).stepUp.resubmit,'manual');
    assert.equal(h.upstreamCalls.length,0);
  }finally{await h.close();}
});

test('a refused step-up creates no session and keeps the earlier one: weaker acr, stale auth_time',async()=>{
  const h=await harness();
  try{
    const weak=await h.signIn();
    h.next.acr='weak';
    assert.equal((await h.signIn('?acr_values=strong',weak.cookie)).status,401);
    h.next.acr='strong';h.next.authTime=Math.floor(Date.now()/1000)-3600;
    const stale=await h.signIn('?max_age=300&acr_values=strong',weak.cookie);
    assert.equal(stale.status,401);assert.equal(stale.cookie,undefined);
    assert.equal((await h.call(weak.cookie!,'/v1/profile')).status,200,'the earlier session is unchanged');
  }finally{await h.close();}
});

test('the return path is a same-origin allowlisted path; anything else is refused before the provider is asked',async()=>{
  const h=await harness();
  try{
    for(const target of ['https://evil.example','//evil.example','/\\evil.example','/admin','/orders/x','http://localhost:4401/orders/1'])
      assert.equal((await h.signIn('?return_to='+encodeURIComponent(target))).status,400,target);
    assert.equal((await h.signIn('?acr_values=unknown')).status,400,'an acr outside the allowlist');
    assert.equal((await h.signIn('?max_age=-1')).status,400);
    assert.equal(h.authorize.length,0);
    const plain=await h.signIn();assert.equal(plain.location,'http://localhost:4401/');
  }finally{await h.close();}
});

test('an RFC 9470 challenge of an upstream API becomes a typed step-up; other headers and the body stay behind',async()=>{
  const h=await harness();
  try{
    const {cookie}=await h.signIn();
    h.setChallenge('Bearer error="insufficient_user_authentication", error_description="A different authentication level is required", acr_values="strong unknown", max_age="120"');
    const response=await h.call(cookie!,'/v1/profile');
    assert.equal(response.status,401);
    assert.deepEqual((JSON.parse(response.text) as {stepUp:unknown}).stepUp,{maxAge:120,acrValues:['strong'],login:'/api/session/login?max_age=120&acr_values=strong',resubmit:'idempotent'});
    assert.equal(response.headers.get('x-internal'),null);assert.ok(!response.text.includes('upstream body'));
    h.setChallenge('Bearer error="invalid_token"');
    const other=await h.call(cookie!,'/v1/profile');
    assert.equal(other.status,401);assert.ok(!other.text.includes('STEP_UP_REQUIRED'));
  }finally{await h.close();}
});

test('route requirements are validated at startup against the acr allowlist',()=>{
  const base={publicOrigin:'http://localhost:4401',issuer:'http://127.0.0.1:1/realms/test',clientId:'web',audience:'api',cookieName:'test_session',development:true as const};
  assert.throws(()=>createBff({...base,routes:[{method:'GET',pattern:/^\/x$/,origin:'http://127.0.0.1:2',authentication:{acr:['strong']}}]}),/INVALID_ROUTE_AUTHENTICATION/);
  assert.throws(()=>createBff({...base,routes:[{method:'GET',pattern:/^\/x$/,origin:'http://127.0.0.1:2',authentication:{maxAge:-5}}]}),/INVALID_ROUTE_AUTHENTICATION/);
  assert.equal(typeof createBff({...base,routes:[{method:'GET',pattern:/^\/x$/,origin:'http://127.0.0.1:2',authentication:{maxAge:300}}]}),'function','max_age alone needs no acr levels');
});
