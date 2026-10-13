import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createBff} from '../src/index.js';
import {createMemorySessionVault} from '../src/session-store.js';

test('identity refresh outages fail closed without discarding recoverable server-only state',async t=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const vault=createMemorySessionVault();
  let issuer='',nonce='',mode='ok',apiCalls=0,refreshCalls=0,certsMode='ok',rejectUpdate=false;
  const update=vault.update.bind(vault);
  vault.update=async(...parameters)=>{
    if(rejectUpdate)throw Object.assign(new Error('synthetic-store-failure'),{status:503});
    return update(...parameters);
  };
  const jwt=(aud:string,seconds:number,kid='first',extra:Record<string,unknown>={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid})).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'synthetic-customer',iat:now,exp:now+seconds,realm_access:{roles:['customer']},...extra})).toString('base64url');
    const input=header+'.'+payload;
    return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){
      if(certsMode==='outage'){res.statusCode=503;res.end('{"private_provider_detail":"not-for-browser"}');return;}
      res.end(JSON.stringify({keys:(mode==='rotated'?['first','rotated']:['first']).map(kid=>({...publicKey.export({format:'jwk'}),kid,alg:'RS256',use:'sig'}))}));return;
    }
    if(req.url?.endsWith('/token')){
      const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const parameters=new URLSearchParams(Buffer.concat(chunks).toString());
      if(parameters.get('grant_type')==='refresh_token'){
        refreshCalls++;
        assert.equal(parameters.get('refresh_token'),'synthetic-server-only-refresh');
        if(mode==='disconnect'){req.socket.destroy();return;}
        if(mode==='timeout')return;
        if(mode==='503'||mode==='429'){res.statusCode=Number(mode);res.end('{"private_provider_detail":"not-for-browser"}');return;}
        if(mode==='invalid-grant'||mode==='invalid-client'){res.statusCode=mode==='invalid-client'?401:400;res.end(JSON.stringify({error:mode==='invalid-client'?'invalid_client':'invalid_grant'}));return;}
        if(mode==='malformed'){res.end('not-json');return;}
        if(mode==='invalid-token'){res.end(JSON.stringify({access_token:jwt('wrong-audience',300),refresh_token:'unverified-new-refresh'}));return;}
        res.end(JSON.stringify({access_token:jwt('api',300,mode==='rotated'?'rotated':'first'),refresh_token:'synthetic-server-only-refresh'}));return;
      }
      // A valid but nearly-expiring access token exercises refresh without wall-clock sleeps.
      res.end(JSON.stringify({access_token:jwt('api',10),refresh_token:'synthetic-server-only-refresh',id_token:jwt('web',300,'first',{nonce})}));return;
    }
    if(req.url?.startsWith('/v1/orders')){apiCalls++;res.end('{"items":[]}');return;}
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const upstream='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=upstream+'/realms/test';
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'outage_session',development:true,sessionVault:vault,routes:[
    {method:'GET',pattern:/^\/v1\/orders$/,roles:['customer'],origin:upstream},
    {method:'POST',pattern:/^\/v1\/orders$/,roles:['customer'],origin:upstream}
  ]}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const login=async()=>{
    mode='ok';certsMode='ok';
    const response=await fetch(base+'/login',{redirect:'manual'}),target=new URL(response.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    const callback=await fetch(base+'/callback?code=synthetic&state='+target.searchParams.get('state'),{headers:{cookie:response.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
    assert.equal(callback.status,303);
    const cookie=callback.headers.getSetCookie()[0]!.split(';')[0]!,id=cookie.split('=')[1]!;
    const record=await vault.read<{csrf:string}>('session',id);assert.ok(record);
    return {cookie,id,record,headers:{cookie,origin:'http://localhost:4401','x-csrf-token':record.value.csrf,'content-type':'application/json'}};
  };
  try{
    for(const outage of ['503','429','disconnect'])await t.test(outage+' preserves the unchanged vault, denies reads/writes, then recovers',async()=>{
      const current=await login(),callsBefore=apiCalls,refreshBefore=refreshCalls;mode=outage;
      for(const [path,options] of [['/context',{headers:{cookie:current.cookie}}],['/v1/orders',{headers:{cookie:current.cookie}}],['/v1/orders',{method:'POST',headers:current.headers,body:'{}'}]] as const){
        const response=await fetch(base+path,options);assert.equal(response.status,503);
        assert.deepEqual(await response.json(),{type:'about:blank',status:503,title:'SERVICE_UNAVAILABLE'});
        assert.equal(response.headers.getSetCookie().length,0);
        assert.ok(isDeepStrictEqual(await vault.read('session',current.id),current.record),'verified vault record remains byte-for-byte unchanged');
      }
      assert.equal(apiCalls,callsBefore);assert.equal(refreshCalls,refreshBefore+3,'no automatic replay/retry');
      mode='ok';const response=await fetch(base+'/context',{headers:{cookie:current.cookie}});assert.equal(response.status,200);
      const context=await response.json() as {subject:string;csrf:string};assert.equal(context.subject,'synthetic-customer');assert.equal(context.csrf,current.record.value.csrf);
      assert.ok(!JSON.stringify(context).includes('refresh'));assert.notEqual((await vault.read('session',current.id))?.revision,current.record.revision);
      assert.equal((await fetch(base+'/v1/orders',{headers:{cookie:current.cookie}})).status,200);assert.equal(apiCalls,callsBefore+1);
    });
    await t.test('a rotated signing key outage retains only the old verified record',async()=>{
      const current=await login();mode='rotated';certsMode='outage';
      const response=await fetch(base+'/context',{headers:{cookie:current.cookie}});assert.equal(response.status,503);
      assert.ok(isDeepStrictEqual(await vault.read('session',current.id),current.record),'no unverified rotated token is saved');
      certsMode='ok';assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,200);
    });
    await t.test('the bounded real transport timeout retains no new token and recovers',async()=>{
      const current=await login();mode='timeout';const before=refreshCalls;
      assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,503);
      assert.equal(refreshCalls,before+1);assert.ok(isDeepStrictEqual(await vault.read('session',current.id),current.record));
      mode='ok';assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,200);
    });
    for(const rejected of ['invalid-grant','invalid-client','invalid-token','malformed'])await t.test(rejected+' cannot retain or resurrect authority',async()=>{
      const current=await login();mode=rejected;
      assert.notEqual((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,200);
      assert.equal(await vault.read('session',current.id),undefined);
      mode='ok';assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,401);
    });
    await t.test('a generic503 vault update failure is not classified as a provider outage',async()=>{
      const current=await login();rejectUpdate=true;
      try{
        assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,503);
        assert.equal(await vault.read('session',current.id),undefined);
      }finally{rejectUpdate=false;}
      assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,401);
    });
    await t.test('logout during provider outage removes state without refreshing',async()=>{
      const current=await login();mode='503';const before=refreshCalls;
      assert.equal((await fetch(base+'/logout',{method:'POST',headers:current.headers,body:'{}'})).status,200);
      assert.equal(refreshCalls,before);assert.equal(await vault.read('session',current.id),undefined);
      mode='ok';assert.equal((await fetch(base+'/context',{headers:{cookie:current.cookie}})).status,401);
    });
  }finally{
    bff.closeAllConnections();provider.closeAllConnections();
    await Promise.all([new Promise<void>(resolve=>bff.close(()=>resolve())),new Promise<void>(resolve=>provider.close(()=>resolve()))]);
  }
});
