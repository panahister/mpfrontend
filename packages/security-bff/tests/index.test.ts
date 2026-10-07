import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createBff} from '../src/index.js';

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
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',supportedUiLocales:['en','ar'],uiLocaleCookie:'preferred_locale',development:true,routes:[{method:'GET',pattern:/^\/v1\/orders$/,roles:['customer'],origin:providerOrigin},{method:'POST',pattern:/^\/v1\/orders$/,roles:['customer'],origin:providerOrigin},{method:'GET',pattern:/^\/v1\/admin$/,roles:['admin'],origin:providerOrigin},{method:'POST',pattern:/^\/v1\/adapter$/,roles:['customer'],origin:providerOrigin,invoke:async input=>{adapterCalls++;assert.ok(input.headers.authorization?.startsWith('Bearer '));return {status:200,body:{received:input.body?.byteLength}};}}]}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  try{
    assert.equal((await fetch(base+'/context')).status,401);
    const unsupported=new URL((await fetch(base+'/login?ui_locales=fa',{redirect:'manual'})).headers.get('location')!);
    assert.equal(unsupported.searchParams.has('ui_locales'),false);
    const cookieLocale=new URL((await fetch(base+'/login',{headers:{cookie:'preferred_locale=ar'},redirect:'manual'})).headers.get('location')!);
    assert.equal(cookieLocale.searchParams.get('ui_locales'),'ar');
    const login=await fetch(base+'/login?ui_locales=ar',{redirect:'manual'}),location=new URL(login.headers.get('location')!);
    nonce=location.searchParams.get('nonce')!;const state=location.searchParams.get('state')!;
    assert.equal(location.searchParams.get('code_challenge_method'),'S256');assert.ok(location.searchParams.get('code_challenge'));
    assert.equal(location.searchParams.get('prompt'),'login');
    assert.equal(location.searchParams.get('ui_locales'),'ar');
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
