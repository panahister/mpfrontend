import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createBff,productionRefusals,type ProductionBffConfig} from '../src/index.js';
import {createMemorySessionVault,createVaultTicketStore,redisVaultSecurity,type SessionVault,type VaultSecurity} from '../src/session-store.js';

/** A shared-vault double: the memory implementation, described as durable, TLS and authenticated. */
function sharedVault(security:Partial<VaultSecurity>={}){
  const memory=createMemorySessionVault();let unavailable=false;
  const guard=<T>(operation:()=>Promise<T>)=>unavailable?Promise.reject(new Error('SESSION_STORE_UNAVAILABLE')):operation();
  const vault:SessionVault={
    profile:'redis-validation',security:{durable:true,tls:true,authenticated:true,hostKeyRing:true,...security},
    read:(kind,id)=>guard(()=>memory.read(kind,id)),create:(kind,id,value,expires)=>guard(()=>memory.create(kind,id,value,expires)),
    consume:(kind,id)=>guard(()=>memory.consume(kind,id)),remove:(kind,id)=>guard(()=>memory.remove(kind,id)),
    acquire:(id,owner,lease)=>guard(()=>memory.acquire(id,owner,lease)),release:(id,owner)=>guard(()=>memory.release(id,owner)),
    update:(id,expected,value,owner)=>guard(()=>memory.update(id,expected,value,owner)),healthy:async()=>!unavailable,
  };
  return {vault,memory,setUnavailable:(value:boolean)=>{unavailable=value;}};
}
const complete=(vault:SessionVault):ProductionBffConfig=>({
  publicOrigin:'https://app.example.test',issuer:'https://identity.example.test/realms/product',clientId:'web',audience:'api',
  cookieName:'app_session',routes:[],production:{sessionVault:vault,clientAuthentication:{method:'none',publicClient:true},secureCookies:true},
});

test('the production profile starts when every condition holds',()=>{
  assert.deepEqual(productionRefusals(complete(sharedVault().vault)),[]);
  assert.equal(typeof createBff(complete(sharedVault().vault)),'function');
});

test('the production profile refuses each missing condition by name',()=>{
  const refusal=(config:ProductionBffConfig)=>{try{createBff(config);}catch(error){return (error as Error).message;}return 'STARTED';};
  const base=complete(sharedVault().vault);
  assert.equal(refusal({...base,publicOrigin:'http://app.example.test'}),'PRODUCTION_PROFILE_REFUSED:HTTPS_PUBLIC_ORIGIN_REQUIRED');
  assert.equal(refusal({...base,issuer:'http://identity.example.test/realms/product'}),'PRODUCTION_PROFILE_REFUSED:HTTPS_IDENTITY_PROVIDER_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,sessionVault:createMemorySessionVault()}}),
    'PRODUCTION_PROFILE_REFUSED:DURABLE_SESSION_VAULT_REQUIRED,SESSION_VAULT_TLS_REQUIRED,SESSION_VAULT_AUTHENTICATION_REQUIRED,HOST_KEY_RING_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,sessionVault:sharedVault({tls:false}).vault}}),'PRODUCTION_PROFILE_REFUSED:SESSION_VAULT_TLS_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,sessionVault:sharedVault({authenticated:false}).vault}}),'PRODUCTION_PROFILE_REFUSED:SESSION_VAULT_AUTHENTICATION_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,sessionVault:sharedVault({hostKeyRing:false}).vault}}),'PRODUCTION_PROFILE_REFUSED:HOST_KEY_RING_REQUIRED');
  const unknown:SessionVault={...sharedVault().vault,security:undefined as never};
  assert.match(refusal({...base,production:{...base.production,sessionVault:unknown}}),/^PRODUCTION_PROFILE_REFUSED:DURABLE_SESSION_VAULT_REQUIRED/);
  assert.equal(refusal({...base,production:{...base.production,clientAuthentication:undefined as never}}),'PRODUCTION_PROFILE_REFUSED:CLIENT_AUTHENTICATION_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,clientAuthentication:{method:'none'} as never}}),'PRODUCTION_PROFILE_REFUSED:CLIENT_AUTHENTICATION_REQUIRED');
  assert.equal(refusal({...base,production:{...base.production,secureCookies:false as never}}),'PRODUCTION_PROFILE_REFUSED:SECURE_COOKIES_REQUIRED');
});

test('the production profile refuses an identity provider origin that is not HTTPS, in the issuer and in the provider origin the BFF calls',()=>{
  // The issuer is where the browser is sent and what a token's iss claim must equal; the provider origin is
  // where the BFF itself fetches signing keys, exchanges codes and refresh tokens, and revokes. Each is read on
  // its own, so each is refused on its own, and the refusal comes before any request is made.
  const base=complete(sharedVault().vault);
  const started=(config:ProductionBffConfig)=>{try{createBff(config);}catch(error){return (error as Error).message;}return 'STARTED';};
  const refused='PRODUCTION_PROFILE_REFUSED:HTTPS_IDENTITY_PROVIDER_REQUIRED';
  for(const origin of ['http://identity.example.test','ws://identity.example.test','ftp://identity.example.test','identity.example.test']){
    const issuer={...base,issuer:origin+'/realms/product'},providerOrigin={...base,providerOrigin:origin};
    assert.deepEqual(productionRefusals(issuer),['HTTPS_IDENTITY_PROVIDER_REQUIRED'],'issuer '+origin);
    assert.deepEqual(productionRefusals(providerOrigin),['HTTPS_IDENTITY_PROVIDER_REQUIRED'],'provider origin '+origin);
    assert.equal(started(issuer),refused,'issuer '+origin);
    assert.equal(started(providerOrigin),refused,'provider origin '+origin);
  }
  assert.deepEqual(productionRefusals({...base,issuer:'http://identity.example.test/realms/product',providerOrigin:'http://identity.internal.test'}),
    ['HTTPS_IDENTITY_PROVIDER_REQUIRED'],'both at once are one named refusal');
  assert.equal(started({...base,providerOrigin:'https://identity.internal.test'}),'STARTED','an HTTPS provider origin other than the issuer is accepted');
  // Outside production the same origins are accepted: a development profile talks to a provider on loopback.
  const development={publicOrigin:'http://localhost:4401',issuer:'http://localhost:4402/realms/test',providerOrigin:'http://127.0.0.1:4402',clientId:'web',audience:'api',cookieName:'test_session',routes:[],development:true as const};
  assert.equal(typeof createBff(development),'function');
});

test('the development profile behaves as before and is still refused under NODE_ENV=production',()=>{
  const development={publicOrigin:'http://localhost:4401',issuer:'http://localhost:4402/realms/test',clientId:'web',audience:'api',cookieName:'test_session',routes:[],development:true as const};
  assert.equal(typeof createBff(development),'function');
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{
    assert.throws(()=>createBff(development),/DURABLE_SESSION_STORE_REQUIRED/);
    assert.equal(typeof createBff(complete(sharedVault().vault)),'function','the production profile does not depend on NODE_ENV');
  }finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('readiness and requests fail with 503 while the shared vault is unavailable, with no memory fallback',async()=>{
  const shared=sharedVault();
  const server=createServer(createBff(complete(shared.vault)));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  try{
    const id='a'.repeat(43);
    await shared.vault.create('session',id,{access:'x',refresh:'y',claims:{sub:'s'},csrf:'c',expires:Date.now()+600000,absoluteExpires:Date.now()+600000},Date.now()+600000);
    assert.equal((await fetch(base+'/health')).status,200);
    assert.equal((await fetch(base+'/context',{headers:{cookie:'__Host-app_session='+id}})).status,200);
    shared.setUnavailable(true);
    const ready=await fetch(base+'/health');assert.equal(ready.status,503);assert.equal((await ready.json() as {title:string}).title,'SERVICE_UNAVAILABLE');
    assert.equal((await fetch(base+'/context',{headers:{cookie:'__Host-app_session='+id}})).status,503);
    const login=await fetch(base+'/login',{redirect:'manual'});assert.equal(login.status,503,'a login cannot fall back to process memory');
    shared.setUnavailable(false);
    assert.equal((await fetch(base+'/context',{headers:{cookie:'__Host-app_session='+id}})).status,200);
    const started=await fetch(base+'/login',{redirect:'manual'});
    assert.ok(started.headers.getSetCookie().every(header=>header.includes('; Secure')),'production cookies are Secure');
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('a Redis vault describes TLS and authentication from its configuration, without logging credentials',()=>{
  assert.deepEqual(redisVaultSecurity({url:'rediss://vault.example.test:6380',password:'host-supplied'}),{durable:true,tls:true,authenticated:true,hostKeyRing:true});
  assert.deepEqual(redisVaultSecurity({url:'rediss://user:secret@vault.example.test:6380'}),{durable:true,tls:true,authenticated:true,hostKeyRing:true});
  assert.deepEqual(redisVaultSecurity({url:'redis://127.0.0.1:6379'}),{durable:true,tls:false,authenticated:false,hostKeyRing:true});
});

test('a vault ticket store is one-time and shared only over a durable vault',async()=>{
  const durable=createVaultTicketStore<{expires:number;value:string}>(sharedVault().vault);
  assert.equal(durable.shared,true);
  await durable.issue('t1',{expires:Date.now()+20000,value:'v'});
  assert.equal((await durable.consume('t1'))?.value,'v');
  assert.equal(await durable.consume('t1'),undefined);
  assert.equal(createVaultTicketStore(createMemorySessionVault()).shared,false);
});

test('a vault ticket store carries the security of its vault, so that the presentation profile can check it',()=>{
  const plain:SessionVault={...createMemorySessionVault(),security:redisVaultSecurity({url:'redis://127.0.0.1:6379'})};
  const secured:SessionVault={...createMemorySessionVault(),security:redisVaultSecurity({url:'rediss://vault.example.test:6380',password:'host-supplied'})};
  assert.deepEqual(createVaultTicketStore(plain).security,{durable:true,tls:false,authenticated:false,hostKeyRing:true});
  assert.deepEqual(createVaultTicketStore(secured).security,{durable:true,tls:true,authenticated:true,hostKeyRing:true});
});
