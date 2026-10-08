import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createBff} from '../src/index.js';
import {createMemorySessionVault,type SessionVault} from '../src/session-store.js';

const event={'http://schemas.openid.net/event/backchannel-logout':{}};

async function harness(options:{enabled?:boolean;vault?:SessionVault}={}){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const other=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='',next={sub:'person-1',sid:'sid-1'};
  const jwt=(claims:Record<string,unknown>,key=privateKey,alg='RS256')=>{
    const header=Buffer.from(JSON.stringify({alg,kid:'idp',typ:'logout+jwt'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
    return header+'.'+payload+'.'+(alg==='none'?'':sign('RSA-SHA256',Buffer.from(header+'.'+payload),key).toString('base64url'));
  };
  const now=()=>Math.floor(Date.now()/1000);
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'idp',alg:'RS256',use:'sig'}]}));return;}
    if(req.url?.endsWith('/token')){
      for await(const chunk of req)void chunk;
      const base={iss:issuer,sub:next.sub,iat:now(),exp:now()+300};
      res.end(JSON.stringify({access_token:jwt({...base,aud:'api'}),refresh_token:'r',id_token:jwt({...base,aud:'web',nonce,sid:next.sid})}));return;
    }
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  issuer='http://127.0.0.1:'+(provider.address() as {port:number}).port+'/realms/test';
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',routes:[],development:true,
    backChannelLogout:options.enabled??true,...(options.vault?{sessionVault:options.vault}:{})}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const signIn=async(sub:string,sid:string)=>{
    next={sub,sid};
    const login=await fetch(base+'/login',{redirect:'manual'}),target=new URL(login.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    const callback=await fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
    assert.equal(callback.status,303);return callback.headers.getSetCookie()[0]!.split(';')[0]!;
  };
  const status=async(cookie:string)=>(await fetch(base+'/context',{headers:{cookie}})).status;
  const logoutToken=(claims:Record<string,unknown>)=>jwt({iss:issuer,aud:'web',iat:now(),exp:now()+120,jti:randomUUID(),events:event,...claims});
  const post=(token:string,type='application/x-www-form-urlencoded')=>fetch(base+'/backchannel-logout',{method:'POST',headers:{'content-type':type},body:new URLSearchParams({logout_token:token}).toString()});
  const close=async()=>{for(const server of [bff,provider])server.closeAllConnections();await Promise.all([bff,provider].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));};
  return {issuer,jwt,other,now,signIn,status,logoutToken,post,close};
}

test('a valid logout token with a sid ends exactly the sessions of that provider session',async()=>{
  const h=await harness();
  try{
    const first=await h.signIn('person-1','sid-1'),second=await h.signIn('person-1','sid-2'),stranger=await h.signIn('person-2','sid-3');
    const response=await h.post(h.logoutToken({sid:'sid-1',sub:'person-1'}));
    assert.equal(response.status,200);assert.equal(await response.text(),'','no session list or count is returned');
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(await h.status(first),401);
    assert.equal(await h.status(second),200);
    assert.equal(await h.status(stranger),200);
  }finally{await h.close();}
});

test('a logout token with only a subject ends every session of that subject',async()=>{
  const h=await harness();
  try{
    const first=await h.signIn('person-1','sid-1'),second=await h.signIn('person-1','sid-2'),stranger=await h.signIn('person-2','sid-3');
    assert.equal((await h.post(h.logoutToken({sub:'person-1'}))).status,200);
    assert.equal(await h.status(first),401);assert.equal(await h.status(second),401);
    assert.equal(await h.status(stranger),200);
  }finally{await h.close();}
});

test('a replayed logout token is refused with 400 and changes nothing',async()=>{
  const h=await harness();
  try{
    await h.signIn('person-1','sid-1');
    const token=h.logoutToken({sid:'sid-1'});
    assert.equal((await h.post(token)).status,200);
    const later=await h.signIn('person-1','sid-1');
    assert.equal((await h.post(token)).status,400);
    assert.equal(await h.status(later),200,'a replay cannot end a later session');
  }finally{await h.close();}
});

test('an invalid logout token is answered 400 and changes nothing',async()=>{
  const h=await harness();
  try{
    const cookie=await h.signIn('person-1','sid-1');
    const base={iss:h.issuer,aud:'web',iat:h.now(),exp:h.now()+120,jti:randomUUID(),events:event,sid:'sid-1'};
    const without=(name:string)=>Object.fromEntries(Object.entries(base).filter(([key])=>key!==name));
    const invalid:Record<string,string>={
      unsigned:h.jwt(base,undefined,'none'),
      'foreign signature':h.jwt(base,h.other.privateKey),
      'wrong issuer':h.jwt({...base,iss:'https://other.example.test/realms/test'}),
      'wrong audience':h.jwt({...base,aud:'another-client'}),
      'no logout event':h.jwt(without('events')),
      'another event':h.jwt({...base,events:{'http://schemas.openid.net/event/other':{}}}),
      'a nonce':h.jwt({...base,nonce:'n'}),
      'neither sid nor sub':h.jwt(without('sid')),
      'no iat':h.jwt(without('iat')),
      'no jti':h.jwt(without('jti')),
      expired:h.jwt({...base,iat:h.now()-600,exp:h.now()-300}),
      'an old iat':h.jwt({...base,iat:h.now()-600}),
      'not a token':'x.y.z',
    };
    for(const [name,token] of Object.entries(invalid)){
      const response=await h.post(token);
      assert.equal(response.status,400,name);
      assert.ok(!(await response.text()).includes('sid-1'),name);
    }
    assert.equal((await h.post(h.logoutToken({sid:'sid-1'}),'application/json')).status,400,'a form body is required');
    assert.equal(await h.status(cookie),200,'nothing changed');
  }finally{await h.close();}
});

test('the endpoint is off unless configured, and a vault without an index is refused at startup',async()=>{
  const h=await harness({enabled:false});
  try{assert.equal((await h.post(h.logoutToken({sub:'person-1'}))).status,404);}finally{await h.close();}
  const {indexSession:_index,...plain}=createMemorySessionVault();void _index;
  assert.throws(()=>createBff({publicOrigin:'http://localhost:4401',issuer:'http://127.0.0.1:1/realms/test',clientId:'web',audience:'api',cookieName:'test_session',routes:[],
    development:true,backChannelLogout:true,sessionVault:plain as SessionVault}),/BACKCHANNEL_LOGOUT_VAULT_UNSUPPORTED/);
});

test('a store outage fails closed: the logout is not acknowledged, no session is served, and a retry succeeds',async()=>{
  const memory=createMemorySessionVault();let unavailable=false;
  const guard=<T>(operation:()=>Promise<T>)=>unavailable?Promise.reject(new Error('SESSION_STORE_UNAVAILABLE')):operation();
  const vault:SessionVault={profile:'memory-development',
    read:(kind,id)=>guard(()=>memory.read(kind,id)),create:(kind,id,value,expires)=>guard(()=>memory.create(kind,id,value,expires)),
    consume:(kind,id)=>guard(()=>memory.consume(kind,id)),remove:(kind,id)=>guard(()=>memory.remove(kind,id)),
    acquire:(id,owner,lease)=>guard(()=>memory.acquire(id,owner,lease)),release:(id,owner)=>guard(()=>memory.release(id,owner)),
    update:(id,expected,value,owner)=>guard(()=>memory.update(id,expected,value,owner)),healthy:async()=>!unavailable,
    indexSession:(id,keys,expires)=>guard(()=>memory.indexSession!(id,keys,expires)),revokeIndexed:(kind,value)=>guard(()=>memory.revokeIndexed!(kind,value))};
  const h=await harness({vault});
  try{
    const cookie=await h.signIn('person-1','sid-1');
    const token=h.logoutToken({sid:'sid-1'});
    unavailable=true;
    assert.equal((await h.post(token)).status,503);
    assert.equal(await h.status(cookie),503,'no session is served while the store is unavailable');
    unavailable=false;
    assert.equal((await h.post(token)).status,200,'the provider may retry the same token');
    assert.equal(await h.status(cookie),401);
  }finally{await h.close();}
});
