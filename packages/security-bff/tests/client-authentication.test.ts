import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type IncomingHttpHeaders} from 'node:http';
import {generateKeyPairSync,sign,verify} from 'node:crypto';
import {createBff,clientAssertion,productionRefusals,CLIENT_ASSERTION_LIFETIME_SECONDS,type ClientAuthentication,type ProductionBffConfig} from '../src/index.js';
import {createMemorySessionVault,type SessionVault} from '../src/session-store.js';

const signer=generateKeyPairSync('rsa',{modulusLength:2048});
const nextSigner=generateKeyPairSync('ec',{namedCurve:'P-256'});
const secret='host-held-secret value&+';
const decode=(part:string)=>JSON.parse(Buffer.from(part,'base64url').toString()) as Record<string,unknown>;

/** A provider that records every token and logout request, and a BFF that signs in once through it. */
async function harness(clientAuthentication:ClientAuthentication,tokenStatus=200){
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  let nonce='',issuer='';const requests:{path:string;body:URLSearchParams;headers:IncomingHttpHeaders}[]=[];
  const jwt=(aud:string,extra:Record<string,unknown>={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'idp'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'person-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,...extra})).toString('base64url');
    return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
  };
  const provider=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'idp',alg:'RS256',use:'sig'}]}));return;}
    const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    requests.push({path:req.url??'',body:new URLSearchParams(Buffer.concat(chunks).toString()),headers:req.headers});
    if(req.url?.endsWith('/token')){
      // An identity provider may echo what it received in an error; the BFF must not pass it on.
      if(tokenStatus!==200){res.statusCode=tokenStatus;res.end(JSON.stringify({error:'invalid_client',echo:secret}));return;}
      res.end(JSON.stringify({access_token:jwt('api'),refresh_token:'server-only-refresh',id_token:jwt('web app',{nonce})}));return;
    }
    res.end('{}');
  });
  await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const providerOrigin='http://127.0.0.1:'+(provider.address() as {port:number}).port;issuer=providerOrigin+'/realms/test';
  const bff=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web app',audience:'api',cookieName:'test_session',routes:[],development:true,clientAuthentication}));
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+(bff.address() as {port:number}).port;
  const signIn=async()=>{
    const login=await fetch(base+'/login',{redirect:'manual'}),target=new URL(login.headers.get('location')!);
    nonce=target.searchParams.get('nonce')!;
    return fetch(base+'/callback?code=ok&state='+target.searchParams.get('state'),{headers:{cookie:login.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual'});
  };
  const close=async()=>{for(const server of [bff,provider])server.closeAllConnections();await Promise.all([bff,provider].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));};
  return {base,issuer,requests,signIn,close};
}

test('private_key_jwt: the assertion names the token endpoint, has a unique jti and a short lifetime, and follows the current key id',async()=>{
  let current={keyId:'key-1',privateKey:signer.privateKey};
  const h=await harness({method:'private_key_jwt',key:()=>current});
  try{
    assert.equal((await h.signIn()).status,303);
    current={keyId:'key-2',privateKey:nextSigner.privateKey};
    assert.equal((await h.signIn()).status,303);
    const tokens=h.requests.filter(request=>request.path.endsWith('/token'));
    assert.equal(tokens.length,2);
    const assertions=tokens.map(request=>{
      assert.equal(request.body.get('client_assertion_type'),'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      assert.equal(request.body.get('client_id'),'web app');
      assert.equal(request.body.has('client_secret'),false);assert.equal(request.headers.authorization,undefined);
      return request.body.get('client_assertion')!.split('.');
    });
    const [first,second]=assertions as [string[],string[]];
    assert.deepEqual(decode(first[0]!),{alg:'RS256',kid:'key-1',typ:'JWT'});
    assert.ok(verify('sha256',Buffer.from(first[0]+'.'+first[1]),signer.publicKey,Buffer.from(first[2]!,'base64url')));
    assert.deepEqual(decode(second[0]!),{alg:'ES256',kid:'key-2',typ:'JWT'});
    assert.ok(verify('sha256',Buffer.from(second[0]+'.'+second[1]),{key:nextSigner.publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(second[2]!,'base64url')));
    const [one,two]=[decode(first[1]!),decode(second[1]!)];
    for(const claims of [one,two]){
      assert.equal(claims.aud,h.issuer+'/protocol/openid-connect/token');
      assert.equal(claims.iss,'web app');assert.equal(claims.sub,'web app');
      assert.equal((claims.exp as number)-(claims.iat as number),CLIENT_ASSERTION_LIFETIME_SECONDS);
      assert.ok(CLIENT_ASSERTION_LIFETIME_SECONDS<=300);
    }
    assert.notEqual(one.jti,two.jti);
    assert.notEqual(clientAssertion('c','a',current).split('.')[1],clientAssertion('c','a',current).split('.')[1]);
  }finally{await h.close();}
});

test('client_secret_basic: the secret travels only in the Authorization header of provider requests',async()=>{
  const h=await harness({method:'client_secret_basic',secret});
  try{
    const callback=await h.signIn();assert.equal(callback.status,303);
    const cookie=callback.headers.getSetCookie()[0]!.split(';')[0]!;
    const context=await fetch(h.base+'/context',{headers:{cookie}}),body=await context.text();
    const csrf=(JSON.parse(body) as {csrf:string}).csrf;
    await fetch(h.base+'/logout',{method:'POST',headers:{cookie,origin:'http://localhost:4401','x-csrf-token':csrf,'content-type':'application/json'},body:'{}'});
    const expected='Basic '+Buffer.from('web+app:'+encodeURIComponent(secret).replace(/%20/g,'+')).toString('base64');
    const authenticated=h.requests.filter(request=>request.path.endsWith('/token')||request.path.endsWith('/logout'));
    assert.equal(authenticated.length,2);
    for(const request of authenticated){
      assert.equal(request.headers.authorization,expected);
      assert.ok(!request.body.toString().includes(encodeURIComponent(secret))&&!request.body.toString().includes('host-held'));
    }
    assert.ok(!body.includes('host-held'),'the secret never reaches /context');
  }finally{await h.close();}
});

test('a rejected client authentication returns a generic error and never the credential',async()=>{
  // Every console method counts: log, info and debug go to standard output, warn and error to standard error.
  const logs:string[]=[];const original={log:console.log,info:console.info,debug:console.debug,error:console.error,warn:console.warn};
  for(const name of ['log','info','debug','error','warn'] as const)console[name]=(...values:unknown[])=>{logs.push(values.map(String).join(' '));};
  const pem=signer.privateKey.export({type:'pkcs8',format:'pem'}).toString();
  try{
    for(const authentication of [{method:'client_secret_basic',secret},{method:'private_key_jwt',key:{keyId:'key-1',privateKey:signer.privateKey}}] as ClientAuthentication[]){
      const h=await harness(authentication,401);
      try{
        const callback=await h.signIn(),text=await callback.text();
        assert.equal(callback.status,401);
        assert.ok(!text.includes('host-held')&&!text.includes(pem.slice(40,80))&&!JSON.stringify([...callback.headers]).includes('host-held'));
      }finally{await h.close();}
    }
    assert.ok(logs.every(line=>!line.includes('host-held')&&!line.includes(pem.slice(40,80))),'nothing logs the credential');
  }finally{Object.assign(console,original);}
});

test('a client key must be a private key of a matching algorithm; a secret must be present',()=>{
  const settings={publicOrigin:'http://localhost:4401',issuer:'http://127.0.0.1:1/realms/test',clientId:'web',audience:'api',cookieName:'test_session',routes:[],development:true as const};
  assert.throws(()=>createBff({...settings,clientAuthentication:{method:'private_key_jwt',key:{keyId:'k',privateKey:signer.publicKey}}}),/INVALID_CLIENT_SIGNING_KEY/);
  assert.throws(()=>createBff({...settings,clientAuthentication:{method:'private_key_jwt',key:{keyId:'k',privateKey:signer.privateKey,algorithm:'ES256'}}}),/INVALID_CLIENT_SIGNING_KEY/);
  assert.throws(()=>createBff({...settings,clientAuthentication:{method:'client_secret_basic',secret:''}}),/INVALID_CLIENT_SECRET/);
});

test('the production profile accepts a confidential client and a public client only when declared',()=>{
  const vault:SessionVault={...createMemorySessionVault(),profile:'redis-validation',security:{durable:true,tls:true,authenticated:true,hostKeyRing:true}};
  const config=(clientAuthentication:ClientAuthentication):ProductionBffConfig=>({publicOrigin:'https://app.example.test',issuer:'https://identity.example.test/realms/p',clientId:'web',audience:'api',cookieName:'app_session',routes:[],production:{sessionVault:vault,clientAuthentication,secureCookies:true}});
  assert.deepEqual(productionRefusals(config({method:'private_key_jwt',key:{keyId:'k',privateKey:signer.privateKey}})),[]);
  assert.deepEqual(productionRefusals(config({method:'client_secret_basic',secret})),[]);
  assert.deepEqual(productionRefusals(config({method:'none',publicClient:true})),[]);
  assert.deepEqual(productionRefusals(config({method:'none'} as never)),['CLIENT_AUTHENTICATION_REQUIRED']);
  assert.deepEqual(productionRefusals(config({method:'client_secret_basic',secret:''})),['CLIENT_AUTHENTICATION_REQUIRED']);
  assert.deepEqual(productionRefusals(config({method:'client_secret_post'} as never)),['CLIENT_AUTHENTICATION_REQUIRED']);
});
