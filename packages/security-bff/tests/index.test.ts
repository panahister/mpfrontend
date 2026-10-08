import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff,defaultApiLocales} from '../src/index.js';

// A test fixture, never a built-in locale: a private-use pseudo-locale tag.
const RTL='qps-plocm';

test('OIDC state/PKCE, signed identity, opaque sessions, CSRF, permissions and logout',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',verifier='',authorizationCount=0,apiCalls=0,adapterCalls=0,issuer='';
  const jwt=(aud:string,extra:Record<string,unknown>={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'customer-1',preferred_username:'test',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,realm_access:{roles:['customer']},...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs'))res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]}));
    else if(req.url?.endsWith('/token')){
      const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
      const parameters=new URLSearchParams(Buffer.concat(chunks).toString()),code=parameters.get('code');
      verifier=parameters.get('code_verifier')??'';authorizationCount++;
      let access=jwt(code==='bad-audience'?'other':'api',code==='expired'?{exp:Math.floor(Date.now()/1000)-1}:code==='bad-issuer'?{iss:'https://other.example'}:{});
      if(code==='bad-signature'){const parts=access.split('.');parts[2]='AAAA'+parts[2]!.slice(4);access=parts.join('.');}
      res.end(JSON.stringify({access_token:access,refresh_token:'server-only-refresh',id_token:jwt('web',{nonce:code==='bad-nonce'?'wrong':nonce})}));
    }else if(req.url?.startsWith('/v1/orders')){apiCalls++;assert.ok(req.headers.authorization?.startsWith('Bearer '));res.end(JSON.stringify({items:[]}));}
    else res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',supportedUiLocales:['en',RTL],uiLocaleCookie:'preferred_locale',development:true,routes:[{method:'GET',pattern:/^\/v1\/orders$/,roles:['customer'],origin:providerOrigin},{method:'POST',pattern:/^\/v1\/orders$/,roles:['customer'],origin:providerOrigin},{method:'GET',pattern:/^\/v1\/admin$/,roles:['admin'],origin:providerOrigin},{method:'POST',pattern:/^\/v1\/adapter$/,roles:['customer'],origin:providerOrigin,invoke:async input=>{adapterCalls++;assert.ok(input.headers.authorization?.startsWith('Bearer '));return {status:200,body:{received:input.body?.byteLength}};}}]}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  try{
    assert.equal((await fetch(base+'/context')).status,401);
    const unsupported=new URL((await fetch(base+'/login?ui_locales=qaa',{redirect:'manual'})).headers.get('location')!);
    assert.equal(unsupported.searchParams.has('ui_locales'),false);
    const cookieLocale=new URL((await fetch(base+'/login',{headers:{cookie:'preferred_locale='+RTL},redirect:'manual'})).headers.get('location')!);
    assert.equal(cookieLocale.searchParams.get('ui_locales'),RTL);
    const login=await fetch(base+'/login?ui_locales='+RTL,{redirect:'manual'}),location=new URL(login.headers.get('location')!);
    nonce=location.searchParams.get('nonce')!;const state=location.searchParams.get('state')!;
    assert.equal(location.searchParams.get('code_challenge_method'),'S256');assert.ok(location.searchParams.get('code_challenge'));
    assert.equal(location.searchParams.get('prompt'),'login');
    assert.equal(location.searchParams.get('ui_locales'),RTL);
    assert.equal(location.searchParams.get('redirect_uri'),'http://localhost:4401/api/session/callback');
    const transactionCookie=login.headers.getSetCookie()[0]!.split(';')[0]!;
    assert.equal((await fetch(base+'/callback?code=ok&state='+state,{redirect:'manual'})).status,401);
    const callback=await fetch(base+'/callback?code=ok&state='+state,{headers:{cookie:transactionCookie},redirect:'manual'});
    assert.equal(callback.status,303);assert.ok(verifier);assert.equal(authorizationCount,1);
    const sessionCookie=callback.headers.getSetCookie()[0]!.split(';')[0]!;
    assert.ok(callback.headers.getSetCookie()[0]!.includes('HttpOnly'));
    assert.equal((await fetch(base+'/callback?code=ok&state='+state,{headers:{cookie:transactionCookie},redirect:'manual'})).status,401);
    const context=await (await fetch(base+'/context',{headers:{cookie:sessionCookie}})).json() as {csrf:string;roles:string[]};
    assert.deepEqual(context.roles,['customer']);assert.ok(!JSON.stringify(context).includes('access_token'));assert.ok(!JSON.stringify(context).includes('server-only-refresh'));
    assert.equal((await fetch(base+'/v1/admin',{headers:{cookie:sessionCookie}})).status,403);
    assert.equal((await fetch(base+'/unlisted',{headers:{cookie:sessionCookie}})).status,404);
    assert.equal((await fetch(base+'/v1/orders',{method:'POST',headers:{cookie:sessionCookie,'content-type':'application/json'},body:'{}'})).status,403);
    assert.equal(apiCalls,0);
    assert.equal((await fetch(base+'/v1/orders',{headers:{cookie:sessionCookie}})).status,200);assert.equal(apiCalls,1);
    assert.equal((await fetch(base+'/v1/orders',{method:'POST',headers:{cookie:sessionCookie,origin:'https://evil.example','x-csrf-token':context.csrf,'content-type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/v1/orders',{method:'POST',headers:{cookie:sessionCookie,origin:'http://localhost:4401','x-csrf-token':context.csrf,'content-type':'application/json'},body:'{}'})).status,200);
    const protectedHeaders={cookie:sessionCookie,origin:'http://localhost:4401','x-csrf-token':context.csrf,'content-type':'application/json'};
    assert.equal((await fetch(base+'/v1/adapter',{method:'POST',headers:{cookie:sessionCookie,'content-type':'application/json'},body:'{}'})).status,403);assert.equal(adapterCalls,0);
    assert.equal((await fetch(base+'/v1/adapter',{method:'POST',headers:protectedHeaders,body:'x'.repeat(65537)})).status,413);assert.equal(adapterCalls,0);
    assert.equal((await fetch(base+'/v1/adapter',{method:'POST',headers:protectedHeaders,body:'{}'})).status,200);assert.equal(adapterCalls,1);
    assert.equal((await fetch(base+'/logout',{method:'POST',headers:{cookie:sessionCookie,origin:'http://localhost:4401','x-csrf-token':context.csrf,'content-type':'application/json'},body:'{}'})).status,200);
    assert.equal((await fetch(base+'/context',{headers:{cookie:sessionCookie}})).status,401);
    for(const code of ['bad-audience','expired','bad-issuer','bad-signature','bad-nonce']){
      const rejectedLogin=await fetch(base+'/login',{redirect:'manual'}),target=new URL(rejectedLogin.headers.get('location')!);
      nonce=target.searchParams.get('nonce')!;
      const invalid=await fetch(base+'/callback?code='+code+'&state='+target.searchParams.get('state'),{headers:{cookie:rejectedLogin.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
      assert.equal(invalid.status,401,code);assert.equal(invalid.headers.getSetCookie().length,0);
    }
  }finally{bff.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise<void>(r=>bff.close(()=>r())),new Promise<void>(r=>provider.close(()=>r()))]);}
});

test('production requires durable sessions',()=>{
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{assert.throws(()=>createBff({publicOrigin:'http://localhost:1',issuer:'http://localhost:2/realms/test',clientId:'web',audience:'api',cookieName:'test_session',development:true,routes:[]}),/DURABLE_SESSION_STORE_REQUIRED/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('the upstream Accept-Language is negotiated from the configured allowlist and never forwarded as given',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';const received:string[]=[];
  const jwt=(aud:string,extra:Record<string,unknown>={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs'))res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256',use:'sig'}]}));
    else if(req.url?.endsWith('/token'))res.end(JSON.stringify({access_token:jwt('api'),refresh_token:'server-only-refresh',id_token:jwt('web',{nonce})}));
    else if(req.url?.startsWith('/v1/items')){received.push(String(req.headers['accept-language']));res.end('{}');}
    else res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const settings={publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true as const,routes:[{method:'GET',pattern:/^\/v1\/items$/,origin:providerOrigin}]};
  const servers=[createServer(createBff({...settings,apiLocales:{supported:[RTL,'en'],defaultLocale:RTL}})),createServer(createBff(settings))];
  for(const server of servers)await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    assert.throws(()=>createBff({...settings,apiLocales:{supported:[RTL,'en'],defaultLocale:'qaa'}}),/INVALID_API_LOCALES/);
    assert.throws(()=>createBff({...settings,apiLocales:{supported:[RTL+'\r\n'],defaultLocale:RTL+'\r\n'}}),/INVALID_API_LOCALES/);
    const sessions:string[]=[];
    for(const server of servers){
      const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
      const login=await fetch(base+'/login',{redirect:'manual'}),location=new URL(login.headers.get('location')!);
      nonce=location.searchParams.get('nonce')!;
      const callback=await fetch(base+'/callback?code=ok&state='+location.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
      assert.equal(callback.status,303);sessions.push(base+'|'+callback.headers.getSetCookie()[0]!.split(';')[0]!);
    }
    const ask=async(index:number,language?:string)=>{
      const [base,cookie]=sessions[index]!.split('|') as [string,string];
      const response=await fetch(base+'/v1/items',{headers:{cookie,...(language===undefined?{}:{'accept-language':language})}});
      assert.equal(response.status,200);return received.at(-1);
    };
    // A product lists the locales its backends answer in; the browser's own header never reaches the backend.
    assert.equal(await ask(0,RTL+',en;q=0.8'),RTL);
    assert.equal(await ask(0,'en-US,en;q=0.9'),'en');
    assert.equal(await ask(0,'qaa'),RTL);
    assert.equal(await ask(0),RTL);
    for(const crafted of [RTL+';q=1, <script>alert(1)</script>','en;q=0.1,qps-XX-x-crafted;q=0.2','x'.repeat(400),(RTL+',').repeat(40)]){
      assert.ok([RTL,'en'].includes((await ask(0,crafted))!),crafted);
    }
    // Without configuration only English, MP Frontend's one built-in language, is ever forwarded.
    assert.deepEqual(defaultApiLocales,{supported:['en'],defaultLocale:'en'});
    assert.equal(await ask(1,RTL),'en');
    assert.equal(await ask(1,'qaa;q=1, '+RTL+';q=0.9'),'en');
    assert.equal(await ask(1,'en-GB,en;q=0.9'),'en');
    assert.ok(received.every(value=>[RTL,'en'].includes(value)));
  }finally{
    for(const server of [...servers,provider])server.closeAllConnections();
    await Promise.all([...servers,provider].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
  }
});
