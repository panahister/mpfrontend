import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createPresentationRealtime,type AdmissionTicket} from '@mpfrontend/presentation-server';
import {createClient} from '@redis/client';
import {createBff} from '../src/index.js';
import {createRedisSessionVault,type RedisVaultConfig,type SessionVault} from '../src/session-store.js';

const exec=promisify(execFile);
const docker=(...args:string[])=>exec('docker',args,{timeout:30000,maxBuffer:1048576});
const listen=async(server:Server)=>{
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return 'http://127.0.0.1:'+(server.address() as {port:number}).port;
};
const close=async(server:Server)=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));};

test('isolated Redis shared-session contract and two BFF replicas', {timeout:90000},async t=>{
  const container='mpfrontend-session-test-'+randomUUID();
  let created=false;
  const vaults:Array<Awaited<ReturnType<typeof createRedisSessionVault>>>=[],servers:Server[]=[];
  const realtime:Array<ReturnType<typeof createPresentationRealtime>>=[],sockets:WebSocket[]=[];
  let inspector:ReturnType<typeof createClient>|undefined;
  try{
    await docker('run','-d','--name',container,'--label','mpfrontend.test=session-vault',
      '-p','127.0.0.1::6379','redis:8.0-alpine','redis-server','--appendonly','yes','--appendfsync','always','--maxmemory-policy','noeviction');
    created=true;
    const mapping=(await docker('port',container,'6379/tcp')).stdout.trim();
    const url='redis://'+mapping;
    const config:RedisVaultConfig={url,namespace:'test-'+randomUUID(),activeKeyId:'first',keys:{first:randomBytes(32)}};
    const connect=async(c=config)=>{
      const vault=await createRedisSessionVault(c);vaults.push(vault);return vault;
    };
    const ready=async()=>{
      for(let attempt=0;attempt<30;attempt++){try{return await connect();}catch{await delay(100);}}
      throw new Error('isolated Redis did not become ready');
    };
    let a=await ready();
    let b=await connect();
    inspector=createClient({url});inspector.on('error',()=>undefined);await inspector.connect();
    const address=(kind:string,id:string)=>`mpfrontend:{${config.namespace}}:${kind}:`+createHash('sha256').update(id).digest('hex');

    await t.test('atomic cross-replica global and per-session budgets, lease loss and policy consistency',async()=>{
      const shared={...config,namespace:'quota-'+randomUUID(),budget:{connections:3,connectionsPerSession:2,
        connectionLeaseMs:200,tickets:3,ticketsPerSession:2,ticketWindowMs:200,
        logins:3,loginsPerPeer:2,loginWindowMs:200}};
      const left=await connect(shared),right=await connect(shared);
      const grants=await Promise.all(Array.from({length:12},(_,i)=>(i%2?left:right).limits.connections.reserve('one','id-'+i)));
      assert.equal(grants.filter(Boolean).length,2);
      const ids=grants.flatMap((grant,i)=>grant?['id-'+i]:[]);
      await right.limits.connections.release('wrong',ids[0]!);
      assert.equal(await left.limits.connections.reserve('one','wrong-release-did-not-free'),undefined);
      assert.equal(await right.limits.connections.reserve('two','third'),200);
      assert.equal(await left.limits.connections.reserve('three','fourth'),undefined);
      await right.limits.connections.release('one',ids[0]!);
      assert.equal(await left.limits.connections.reserve('three','fourth'),200);
      assert.equal(await right.limits.connections.renew('wrong',ids[1]!),undefined);
      assert.equal(await right.limits.connections.renew('one',ids[1]!),200);
      await delay(260);
      assert.equal(await left.limits.connections.renew('one',ids[1]!),undefined);
      assert.equal(await right.limits.connections.reserve('one','reclaimed'),200);
      for(const category of ['ticket','login'] as const){
        const replies=await Promise.all(Array.from({length:12},(_,i)=>(i%2?left:right).limits.take(category,'one')));
        assert.equal(replies.filter(Boolean).length,2);
        assert.equal(await left.limits.take(category,'two'),true);
        assert.equal(await right.limits.take(category,'three'),false);
        await delay(260);assert.equal(await left.limits.take(category,'one'),true);
      }
      await assert.rejects(()=>createRedisSessionVault({...shared,budget:{...shared.budget,connections:4}}),/RUNTIME_BUDGET_POLICY_MISMATCH/);
      await assert.rejects(()=>createRedisSessionVault({...shared,budget:{connectionsPerSession:100}}),/INVALID_RUNTIME_BUDGET/);
    });

    await t.test('ciphertext has no credentials and cannot be moved to a different record',async()=>{
      await a!.create('session','one',{access:'sentinel-access',refresh:'sentinel-refresh'},Date.now()+60000);
      const raw=(await inspector!.get(address('session','one')))!;
      assert.ok(!raw.includes('sentinel-access'));assert.ok(!raw.includes('sentinel-refresh'));
      await inspector!.set(address('session','two'),raw,{PX:60000});
      await assert.rejects(()=>b.read('session','two'),/SESSION_STORE_INTEGRITY_FAILURE/);
      assert.deepEqual((await b.read('session','one'))?.value,{access:'sentinel-access',refresh:'sentinel-refresh'});
    });
    await t.test('one-time transaction consumption is atomic across replicas',async()=>{
      await a!.create('transaction','login',{nonce:'one-use'},Date.now()+60000);
      const results=await Promise.all([a!.consume('transaction','login'),b.consume('transaction','login')]);
      assert.equal(results.filter(Boolean).length,1);
    });
    await t.test('TTL removes records',async()=>{
      await a!.create('session','short',{value:true},Date.now()+30);await delay(80);
      assert.equal(await b.read('session','short'),undefined);
      assert.equal(await inspector!.exists(address('session','short')),0);
    });
    await t.test('back-channel index revokes by sid or subject across replicas and stores no session id',async()=>{
      const until=Date.now()+60000,first='index-first-'+randomUUID(),second='index-second-'+randomUUID();
      for(const id of [first,second])await a!.create('session',id,{value:id},until);
      await a!.indexSession!(first,{sid:'provider-sid-1',sub:'subject-1'},until);
      await b.indexSession!(second,{sid:'provider-sid-2',sub:'subject-1'},until);
      const keys=await inspector!.keys(`mpfrontend:{${config.namespace}}:index-*`);
      assert.ok(keys.length>=3);
      for(const key of keys)for(const member of await inspector!.sMembers(key))assert.ok(!member.includes('index-')&&/^[a-f0-9]{64}$/.test(member));
      await b.revokeIndexed!('sid','provider-sid-1');
      assert.equal(await a!.read('session',first),undefined);
      assert.ok(await a!.read('session',second));
      await a!.revokeIndexed!('sub','subject-1');
      assert.equal(await b.read('session',second),undefined);
    });
    await t.test('CAS rejects stale writers, expired leases and logout resurrection',async()=>{
      await a!.create('session','cas',{count:0},Date.now()+60000);
      const original=(await a!.read<{count:number}>('session','cas'))!;
      assert.equal(await a!.acquire('cas','writer-a',1000),true);
      assert.equal(await b.acquire('cas','writer-b',1000),false);
      assert.equal(await b.update('cas',original,{count:1},'writer-b'),false);
      assert.equal(await a!.update('cas',original,{count:1},'writer-a'),true);
      assert.equal(await a!.update('cas',original,{count:2},'writer-a'),false);
      const fresh=(await b.read<{count:number}>('session','cas'))!;
      await b.remove('session','cas');
      assert.equal(await a!.update('cas',fresh,{count:3},'writer-a'),false);
      await a!.release('cas','writer-a');
      await a!.create('session','expired-lock',{count:0},Date.now()+60000);
      const expected=(await a!.read<{count:number}>('session','expired-lock'))!;
      await a!.acquire('expired-lock','old',30);await delay(80);
      assert.equal(await a!.update('expired-lock',expected,{count:1},'old'),false);
    });
    await t.test('key rotation can read old records; unknown keys fail closed',async()=>{
      const rotated=await connect({...config,activeKeyId:'second',keys:{...config.keys,second:randomBytes(32)}});
      assert.ok(await rotated.read('session','one'));
      await rotated.create('session','rotated',{ok:true},Date.now()+60000);
      await assert.rejects(()=>a!.read('session','rotated'),/SESSION_STORE_INTEGRITY_FAILURE/);
      const other=await connect({...config,namespace:'another-'+randomUUID()});
      assert.equal(await other.read('session','one'),undefined);
    });

    const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    let issuer='',nonce='',refreshCount=0,codeCount=0,refreshOutage=false;
    let refreshBarrier:Promise<void>|undefined,refreshEntered:(()=>void)|undefined;
    const jwt=(aud:string,extra:Record<string,unknown>={})=>{
      const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');
      const payload=Buffer.from(JSON.stringify({iss:issuer,aud,sub:'user-1',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,realm_access:{roles:['customer']},...extra})).toString('base64url');
      return header+'.'+payload+'.'+sign('RSA-SHA256',Buffer.from(header+'.'+payload),privateKey).toString('base64url');
    };
    const provider=createServer(async(req,res)=>{
      res.setHeader('content-type','application/json');
      if(req.url?.endsWith('/certs')){res.end(JSON.stringify({keys:[{...publicKey.export({format:'jwk'}),kid:'test'}]}));return;}
      if(req.url?.endsWith('/token')){
        const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
        const parameters=new URLSearchParams(Buffer.concat(chunks).toString());
        const refresh=parameters.get('grant_type')==='refresh_token';
        if(refresh){
          refreshCount++;refreshEntered?.();await refreshBarrier;
          if(refreshOutage){res.statusCode=503;res.end('{"error":"synthetic-provider-outage"}');return;}
        }else codeCount++;
        res.end(JSON.stringify({access_token:jwt('api',refresh?{}:{exp:Math.floor(Date.now()/1000)+10}),refresh_token:'private-refresh-'+refreshCount,id_token:jwt('web',{nonce})}));return;
      }
      res.end('{}');
    });
    servers.push(provider);issuer=await listen(provider)+'/realms/test';
    const bff=async(vault:SessionVault)=>{
      const server=createServer(createBff({publicOrigin:'http://localhost:4401',issuer,clientId:'web',audience:'api',cookieName:'test_session',development:true,sessionVault:vault,routes:[{method:'GET',pattern:/^\/v1\/orders$/,roles:['customer'],origin:new URL(issuer).origin,invoke:async()=>({status:200,body:{private:'must-not-cross-socket'}})}]}));
      servers.push(server);return {server,url:await listen(server)};
    };
    let first=await bff(a),second=await bff(b);
    const login=async()=>{
      const response=await fetch(first.url+'/login',{redirect:'manual'}),location=new URL(response.headers.get('location')!);
      nonce=location.searchParams.get('nonce')!;
      const path='/callback?code=ok&state='+location.searchParams.get('state');
      const options={headers:{cookie:response.headers.getSetCookie()[0]!.split(';')[0]!},redirect:'manual' as const};
      const results=await Promise.all([fetch(first.url+path,options),fetch(second.url+path,options)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[303,401]);
      const cookie=results.find(r=>r.status===303)!.headers.getSetCookie()[0]!.split(';')[0]!;
      return cookie;
    };
    let cookie='';
    await t.test('login can cross replicas; callback replay cannot exchange code twice',async()=>{
      cookie=await login();assert.equal(codeCount,1);
    });
    await t.test('concurrent replica refresh rotates once',async()=>{
      const replies=await Promise.all(Array.from({length:8},(_,i)=>fetch((i%2?first:second).url+'/context',{headers:{cookie}})));
      assert.ok(replies.every(r=>r.status===200));assert.equal(refreshCount,1);
      for(const reply of replies){const text=await reply.text();assert.ok(!text.includes('private-refresh'));assert.ok(!text.includes('access_token'));}
    });
    await t.test('provider outage retains encrypted shared state and releases the lease for another replica',async()=>{
      const outageCookie=await login(),id=outageCookie.split('=')[1]!;
      const before=await a!.read('session',id);assert.ok(before);
      const raw=await inspector!.get(address('session',id)),callsBefore=refreshCount;
      refreshOutage=true;
      try{
        for(const replica of [first,second]){
          const response=await fetch(replica.url+'/context',{headers:{cookie:outageCookie}});
          assert.equal(response.status,503);assert.deepEqual(await response.json(),{type:'about:blank',status:503,title:'SERVICE_UNAVAILABLE'});
          assert.ok(isDeepStrictEqual(await b.read('session',id),before),'shared verified record remains unchanged');
          assert.equal(await inspector!.get(address('session',id)),raw,'no ciphertext rewrite');
          assert.equal(await inspector!.exists(address('lock',id)),0,'owner lease released after failure');
        }
        assert.equal(refreshCount,callsBefore+2,'no internal retry across replicas');
      }finally{refreshOutage=false;}
      assert.equal((await fetch(second.url+'/context',{headers:{cookie:outageCookie}})).status,200);
      assert.notEqual((await b.read('session',id))?.revision,before.revision);
      assert.equal((await b.read('session',id))?.expiresAt,before.expiresAt,'absolute TTL not extended');
    });
    await t.test('reconstructed BFF keeps session; logout racing refresh never resurrects it',async()=>{
      await close(first.server);servers.splice(servers.indexOf(first.server),1);first=await bff(a!);
      assert.equal((await fetch(first.url+'/context',{headers:{cookie}})).status,200);
      cookie=await login();
      let release!:()=>void;
      refreshBarrier=new Promise<void>(resolve=>{release=resolve;});
      const entered=new Promise<void>(resolve=>{refreshEntered=resolve;});
      const pending=fetch(first.url+'/context',{headers:{cookie}});
      try{
        await Promise.race([entered,delay(5000).then(()=>{throw new Error('refresh did not start');})]);
        const id=cookie.split('=')[1]!;
        const saved=await b.read<{csrf:string}>('session',id);assert.ok(saved);
        assert.equal((await fetch(second.url+'/logout',{method:'POST',headers:{cookie,origin:'http://localhost:4401','x-csrf-token':saved.value.csrf,'content-type':'application/json'},body:'{}'})).status,200);
      }finally{release();refreshBarrier=undefined;refreshEntered=undefined;}
      assert.equal((await pending).status,401);
      assert.equal((await fetch(second.url+'/context',{headers:{cookie}})).status,401);
    });
    await t.test('Redis tickets cross presentation replicas and reject concurrent socket replay',async()=>{
      cookie=await login();
      const context=await (await fetch(first.url+'/context',{headers:{cookie}})).json() as {csrf:string};
      const headers={origin:'http://localhost:4401',cookie,'x-csrf-token':context.csrf};
      const presentation=async(vault:Awaited<ReturnType<typeof createRedisSessionVault>>)=>{
        const runtime=createPresentationRealtime({development:true,publicOrigin:headers.origin,bffOrigin:first.url,
          resolve:()=>'/v1/orders',connectionBudget:vault.limits.connections,ticketStore:{
            async issue(id,ticket){if(!await vault.limits.take('ticket',ticket.cookieHash))throw Object.assign(new Error('TICKET_LIMIT'),{status:429});await vault.create('transaction','realtime:'+id,ticket,ticket.expires);},
            async consume(id){return (await vault.consume<AdmissionTicket>('transaction','realtime:'+id))?.value;}
          }});
        realtime.push(runtime);
        const server=createServer((req,res)=>{void runtime.handleHttp(req,res);});runtime.attach(server);servers.push(server);
        return await listen(server);
      };
      const left=await presentation(a!),right=await presentation(b);
      const response=await fetch(left+'/api/realtime/ticket',{method:'POST',headers});assert.equal(response.status,200);
      const ticket=(await response.json() as {ticket:string}).ticket;
      const connect=async(base:string)=>{const ws=new WebSocket(base.replace('http:','ws:')+'/api/realtime',{headers});sockets.push(ws);await once(ws,'open');return ws;};
      const pair=await Promise.all([connect(left),connect(right)]),frames:string[]=[];
      // Both leases are held before subscribe; a third replica connection must fail at HTTP upgrade.
      const rejected=new WebSocket(left.replace('http:','ws:')+'/api/realtime',{headers});sockets.push(rejected);
      rejected.on('error',()=>undefined);
      const rejection=await new Promise<number|undefined>(resolve=>rejected.on('unexpected-response',(_request,response)=>{
        response.resume();rejected.terminate();resolve(response.statusCode);
      }));
      assert.equal(rejection,429);
      const outcome=(ws:WebSocket)=>new Promise<string>(resolve=>{
        ws.on('message',raw=>{frames.push(raw.toString());if(JSON.parse(raw.toString()).type==='ready')resolve('ready');});
        ws.on('close',code=>resolve(code===4003?'rejected':'unexpected-close'));
      });
      const results=pair.map(outcome);
      for(const ws of pair)ws.send(JSON.stringify({v:1,type:'subscribe',ticket,resources:['orders']}));
      assert.deepEqual((await Promise.all(results)).sort(),['ready','rejected']);
      assert.ok(!frames.join('').includes('private'));assert.ok(!frames.join('').includes('private-refresh'));
      for(const ws of pair)ws.terminate();
    });
    await t.test('Redis AOF restart retains sessions, revocations and consumed transactions',async()=>{
      cookie=await login();assert.equal((await fetch(second.url+'/context',{headers:{cookie}})).status,200);
      await a!.create('session','durable',{marker:true},Date.now()+60000);
      await a!.create('transaction','consumed',{nonce:'used'},Date.now()+60000);await b.consume('transaction','consumed');
      await a!.create('session','revoked',{marker:true},Date.now()+60000);await b.remove('session','revoked');
      for(const vault of vaults)await vault.close();inspector!.destroy();inspector=undefined;
      await docker('restart',container);
      // Docker may reassign an automatically published host port on restart.
      const restartedMapping=(await docker('port',container,'6379/tcp')).stdout.trim();
      if(restartedMapping!==mapping)t.diagnostic('Docker reassigned the isolated test host port on restart');
      config.url='redis://'+restartedMapping;
      a=await ready();b=await connect();
      await close(first.server);servers.splice(servers.indexOf(first.server),1);first=await bff(a);
      await close(second.server);servers.splice(servers.indexOf(second.server),1);second=await bff(b);
      assert.deepEqual((await b.read('session','durable'))?.value,{marker:true});
      assert.equal(await b.read('session','revoked'),undefined);assert.equal(await b.consume('transaction','consumed'),undefined);
      assert.equal((await fetch(first.url+'/context',{headers:{cookie}})).status,200);
    });
    await t.test('store outage denies protected requests and readiness; never falls back to memory',async()=>{
      await docker('stop','-t','1',container);await delay(100);
      assert.equal((await fetch(first.url+'/context',{headers:{cookie}})).status,503);
      assert.equal((await fetch(second.url+'/health')).status,503);
      assert.equal((await fetch(second.url+'/login',{redirect:'manual'})).status,503);
    });
  }finally{
    if(inspector?.isOpen)inspector.destroy();
    for(const ws of sockets)ws.removeAllListeners('close');
    for(const ws of sockets)ws.terminate();
    for(const runtime of realtime)runtime.close();
    await Promise.all(servers.map(close));
    await Promise.all(vaults.map(vault=>vault.close()));
    // Only this test-created container and its anonymous data volume. No shared backend Redis touched.
    if(created)await docker('rm','-f','-v',container);
  }
});
