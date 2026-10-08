import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff,SESSION_LIMITS,type BffConfig} from '../src/index.js';
import {createMemorySessionVault,type SessionVault} from '../src/session-store.js';

type Harness=Awaited<ReturnType<typeof harness>>;
/** A provider whose refreshed tokens can carry other roles, and a BFF over it. */
async function harness(settings:(issuer:string)=>BffConfig){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';const state={roles:['reader'],accessLifetime:300};
  const jwt=(aud:string,extra:Record<string,unknown>,lifetime=300)=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'idp'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+lifetime,...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'idp',alg:'RS256',use:'sig'}]}));return;}
    if(req.url?.endsWith('/token')){
      for await(const chunk of req)void chunk;
      res.end(JSON.stringify({access_token:jwt('api',{realm_access:{roles:state.roles}},state.accessLifetime),refresh_token:'server-only-refresh',id_token:jwt('web',{nonce})}));return;
    }
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  issuer='http://127.0.0.1:'+(provider.address() as {port:number}).port+'/realms/test';
  let handler;
  try{handler=createBff(settings(issuer));}
  catch(error){provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));throw error;}
  const bff=createServer(handler);
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const signIn=async(previous?:string)=>{
    const login=await fetch(base+'/login',{redirect:'manual'}),target=new URL(login.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    const transaction=login.headers.getSetCookie()[0]!;
    const callback=await fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:transaction.split(';')[0]!+(previous?'; '+previous:'')},redirect:'manual'});
    return {transaction,callback,cookie:callback.headers.getSetCookie()[0]!.split(';')[0]!};
  };
  const context=(cookie:string)=>fetch(base+'/context',{headers:{cookie}});
  const close=async()=>{for(const server of [bff,provider])server.closeAllConnections();await Promise.all([bff,provider].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));};
  return {base,state,signIn,context,close};
}
const development=(session?:BffConfig['session'])=>(issuer:string):BffConfig=>({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',routes:[],development:true,...(session?{session}:{})});
const durable=():SessionVault=>({...createMemorySessionVault(),profile:'redis-validation',security:{durable:true,tls:true,authenticated:true,hostKeyRing:true}});

test('production: a __Host- session cookie, Strict by default, while the login transaction cookie stays Lax',async()=>{
  const vault=durable();
  const server=createServer(createBff({publicOrigin:'https://app.example.test',issuer:'https://identity.example.test/realms/p',clientId:'web',audience:'api',
    cookieName:'app_session',routes:[],production:{sessionVault:vault,clientAuthentication:{method:'none',publicClient:true},secureCookies:true}}));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try{
    const login=await fetch(base+'/login',{redirect:'manual'});
    assert.match(login.headers.getSetCookie()[0]!,/^__Host-app_session_login=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=300; Secure$/);
    const id='b'.repeat(43);
    await vault.create('session',id,{access:'a',refresh:'r',claims:{sub:'s'},csrf:'csrf-value',expires:Date.now()+600000,absoluteExpires:Date.now()+600000,lastSeen:Date.now()},Date.now()+600000);
    const logout=await fetch(base+'/logout',{method:'POST',headers:{cookie:'__Host-app_session='+id,origin:'https://app.example.test','x-csrf-token':'csrf-value','content-type':'application/json'},body:'{}'});
    assert.equal(logout.status,200);
    const session=logout.headers.getSetCookie()[0]!;
    assert.match(session,/^__Host-app_session=; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0; Secure$/);
    assert.doesNotMatch(session,/Domain=/i);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  const local=await harness(issuer=>({...development({sameSite:'Strict'})(issuer),publicOrigin:'https://app.example.test',cookieName:'__Host-app_session'}));
  try{
    const {transaction,callback,cookie}=await local.signIn();
    assert.match(transaction,/^__Host-app_session_login=[^;]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=300; Secure$/);
    const session=callback.headers.getSetCookie()[0]!;
    assert.match(session,/^__Host-app_session=[-_a-zA-Z0-9]{43}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800; Secure$/);
    assert.doesNotMatch(session,/Domain=/i);
    assert.equal(callback.status,200,'a Strict cookie is followed by a same-origin page');
    assert.match(await callback.text(),/http-equiv="refresh" content="0;url=\/"/);
    assert.equal((await local.context(cookie)).status,200);
  }finally{await local.close();}
});

test('the session cookie name may carry __Host- only over https, and SameSite defaults to Lax in development',async()=>{
  assert.throws(()=>createBff({...development()('http://127.0.0.1:1/realms/test'),cookieName:'__Host-test_session'}),/HOST_PREFIX_REQUIRES_HTTPS/);
  const h=await harness(development());
  try{
    const {callback}=await h.signIn();
    assert.equal(callback.status,303);
    assert.match(callback.headers.getSetCookie()[0]!,/^test_session=[-_a-zA-Z0-9]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=28800$/);
  }finally{await h.close();}
});

test('lifetimes are configurable within bounded maxima and are never shortened',()=>{
  const config=(session:BffConfig['session'])=>development(session)('http://127.0.0.1:1/realms/test');
  assert.throws(()=>createBff(config({idleTimeoutSeconds:SESSION_LIMITS.maxIdleTimeoutSeconds+1})),/INVALID_SESSION_POLICY/);
  assert.throws(()=>createBff(config({absoluteLifetimeSeconds:SESSION_LIMITS.maxAbsoluteLifetimeSeconds+1})),/INVALID_SESSION_POLICY/);
  assert.throws(()=>createBff(config({idleTimeoutSeconds:7200,absoluteLifetimeSeconds:3600})),/INVALID_SESSION_POLICY/);
  assert.throws(()=>createBff(config({sameSite:'None' as never})),/INVALID_SESSION_POLICY/);
  assert.equal(typeof createBff(config({idleTimeoutSeconds:SESSION_LIMITS.maxIdleTimeoutSeconds,absoluteLifetimeSeconds:SESSION_LIMITS.maxAbsoluteLifetimeSeconds})),'function');
  assert.equal(SESSION_LIMITS.defaultIdleTimeoutSeconds,1800);
});

async function withClock<T>(run:(h:Harness)=>Promise<T>,session:BffConfig['session']){
  mock.timers.enable({apis:['Date'],now:Date.now()});
  const h=await harness(development(session));
  try{return await run(h);}finally{await h.close();mock.timers.reset();}
}

test('an idle session fails closed with 401; activity keeps it alive until the absolute lifetime',async()=>{
  await withClock(async h=>{
    const {cookie}=await h.signIn();
    assert.equal((await h.context(cookie)).status,200);
    mock.timers.tick(61000);
    assert.equal((await h.context(cookie)).status,401,'idle for longer than the idle timeout');
    assert.equal((await h.context(cookie)).status,401,'the idle session was removed');
  },{idleTimeoutSeconds:60,absoluteLifetimeSeconds:300});
  await withClock(async h=>{
    const {cookie}=await h.signIn();
    for(let elapsed=0;elapsed<280;elapsed+=40){mock.timers.tick(40000);assert.equal((await h.context(cookie)).status,200,'active at '+(elapsed+40)+' s');}
    mock.timers.tick(40000);
    assert.equal((await h.context(cookie)).status,401,'past the absolute lifetime despite activity');
  },{idleTimeoutSeconds:60,absoluteLifetimeSeconds:300});
});

test('the session id is new after sign-in and rotates when roles change at refresh, never otherwise',async()=>{
  const h=await harness(development());
  try{
    const first=await h.signIn();
    const second=await h.signIn(first.cookie);
    assert.notEqual(second.cookie,first.cookie);
    assert.equal((await h.context(first.cookie)).status,401,'the pre-sign-in session id is gone');
    // A short access lifetime makes the next request refresh.
    h.state.accessLifetime=20;
    const third=await h.signIn();
    const same=await h.context(third.cookie);
    assert.equal(same.status,200);assert.equal(same.headers.getSetCookie().length,0,'unchanged roles keep the id');
    h.state.roles=['reader','approver'];
    const changed=await h.context(third.cookie);
    assert.equal(changed.status,200);
    const rotated=changed.headers.getSetCookie()[0]!;
    assert.match(rotated,/^test_session=[-_a-zA-Z0-9]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+$/);
    assert.deepEqual((await changed.json() as {roles:string[]}).roles,['reader','approver']);
    assert.equal((await h.context(third.cookie)).status,401,'the old id is removed');
    assert.equal((await h.context(rotated.split(';')[0]!)).status,200);
    for(const header of [...first.callback.headers.getSetCookie(),rotated])assert.ok(!header.includes('.'),'no token or claim in a cookie');
  }finally{await h.close();}
});
