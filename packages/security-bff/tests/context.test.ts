import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff,projectClaims} from '../src/index.js';

// A test fixture, never a built-in locale: a private-use pseudo-locale tag.
const RTL='qps-plocm';

test('allowlisted claims of the ID token reach /context bounded and token-free; the preference cookie only chooses ui_locales',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='',identityClaims:Record<string,unknown>={},refreshIdToken:'same'|'none'|'other'='same';
  const issued:string[]=[];
  const jwt=(aud:string,extra:Record<string,unknown>,lifetime=300)=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+lifetime,...extra})).toString('base64url');
    const token=header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
    issued.push(token);return token;
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]}));return;}
    if(req.url?.endsWith('/token')){
      const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const refresh=new URLSearchParams(Buffer.concat(chunks).toString()).get('grant_type')==='refresh_token';
      // A short access lifetime makes every later request refresh the session.
      const access=jwt('api',{access_only:'from-access'},20);
      const id=refresh?(refreshIdToken==='none'?undefined:jwt('web',refreshIdToken==='other'?{...identityClaims,sub:'person-2'}:identityClaims)):jwt('web',{...identityClaims,nonce});
      res.end(JSON.stringify({access_token:access,refresh_token:'server-only-refresh-'+issued.length,...(id?{id_token:id}:{})}));return;
    }
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const settings={publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true as const,routes:[],supportedUiLocales:['en',RTL]};
  const bff=createServer(createBff({...settings,contextClaims:['locale','theme','email','groups','bio','raw','nested','access_only','missing'],
    preferenceCookie:{name:'mp_preferences',locales:['en',RTL],themes:['light','dark','system']}}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  try{
    for(const names of [['access_token'],['refresh_token'],['nonce'],['a b'],Array.from({length:33},(_,i)=>'c'+i)]){
      assert.throws(()=>createBff({...settings,contextClaims:names}),/INVALID_CONTEXT_CLAIMS/,names.join());
    }
    const location=async(cookie:string)=>new URL((await fetch(base+'/login',{headers:{cookie},redirect:'manual'})).headers.get('location')!);
    assert.equal((await location('mp_preferences=lang='+RTL+'&theme=dark')).searchParams.get('ui_locales'),RTL);
    assert.equal((await location('mp_preferences=lang=de&theme=dark')).searchParams.has('ui_locales'),false);
    const crafted=await fetch(base+'/login',{headers:{cookie:'mp_preferences=lang=<script>&theme=x'},redirect:'manual'});
    assert.ok(!crafted.headers.get('location')!.includes('script')&&!JSON.stringify([...crafted.headers]).includes('<script>'),'an invalid value is never echoed');

    const raw=jwt('elsewhere',{});
    identityClaims={locale:RTL,theme:'dark',email:'person@example.test',groups:['team-a','team-b'],bio:'x'.repeat(600),raw,nested:{role:'admin'}};
    const login=await fetch(base+'/login',{redirect:'manual'}),target=new URL(login.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    const callback=await fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
    assert.equal(callback.status,303);
    assert.ok(callback.headers.getSetCookie().every(header=>!header.includes(RTL)&&!header.includes('dark')),'no claim is written into a cookie');
    const cookie=callback.headers.getSetCookie()[0]!.split(';')[0]!;
    const context=async()=>{const response=await fetch(base+'/context',{headers:{cookie}});const text=await response.text();return {status:response.status,text,body:response.status===200?JSON.parse(text) as {claims:Record<string,unknown>}:undefined};};
    let current=await context();
    assert.deepEqual(current.body!.claims,{locale:RTL,theme:'dark',email:'person@example.test',groups:['team-a','team-b']});
    for(const token of issued)assert.ok(!current.text.includes(token),'no token in /context');
    assert.ok(!current.text.includes('server-only-refresh'));
    assert.ok(Buffer.byteLength(JSON.stringify(current.body!.claims))<=4096);

    // A refreshed ID token of the same person updates the projection; a refresh without one keeps it.
    identityClaims={...identityClaims,theme:'light'};refreshIdToken='same';
    current=await context();assert.equal(current.body!.claims.theme,'light');
    identityClaims={...identityClaims,theme:'dark'};refreshIdToken='none';
    current=await context();assert.equal(current.body!.claims.theme,'light');
    refreshIdToken='other';
    current=await context();assert.equal(current.status,401);
  }finally{
    bff.closeAllConnections();provider.closeAllConnections();
    await Promise.all([new Promise<void>(r=>bff.close(()=>r())),new Promise<void>(r=>provider.close(()=>r()))]);
  }
});

test('the projection keeps plain allowlisted values within 4 KiB and drops tokens and objects',()=>{
  const many=Object.fromEntries(Array.from({length:30},(_,i)=>['claim'+i,'v'.repeat(400)]));
  const projection=projectClaims(many,Object.keys(many));
  assert.ok(Buffer.byteLength(JSON.stringify(projection))<=4096);
  assert.ok(Object.keys(projection).length>0&&Object.keys(projection).length<30);
  assert.deepEqual(projectClaims({a:1,b:true,c:'x',d:{e:1},f:[1],g:['x'],h:'aaaaaaaaaa.bbbbbbbbbb.cccc',i:Number.NaN},['a','b','c','d','f','g','h','i','j']),{a:1,b:true,c:'x',g:['x']});
  assert.deepEqual(projectClaims({secret:'x'},[]),{});
});

test('the claim source is the ID token or, by choice, the access token; nothing else',()=>{
  const settings={publicOrigin:'http://localhost:4401',issuer:'http://127.0.0.1:1/realms/test',clientId:'web',audience:'api',cookieName:'test_session',development:true as const,routes:[]};
  assert.doesNotThrow(()=>createBff({...settings,contextClaims:['locale'],contextClaimSource:'access'}));
  assert.throws(()=>createBff({...settings,contextClaims:['locale'],contextClaimSource:'cookie' as never}),/INVALID_CONTEXT_CLAIMS/);
});
