import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationRealtime,presentationProductionRefusals,type AdmissionTicket,type ConnectionBudget,type ProductionSocketConfig} from '../src/index.js';

const records=new Map<string,AdmissionTicket>();
// A store over a Redis vault describes the vault it keeps its tickets in; the production profile refuses a shared store that does not.
const secured={durable:true,tls:true,authenticated:true};
const sharedStore={shared:true as const,security:secured,async issue(id:string,ticket:AdmissionTicket){records.set(id,ticket);},async consume(id:string){const value=records.get(id);records.delete(id);return value;}};
const sharedBudget:ConnectionBudget={shared:true,async reserve(){return 30000;},async renew(){return 30000;},async release(){}};
const complete:ProductionSocketConfig={publicOrigin:'https://app.example.test',bffOrigin:'http://bff.internal:4310',resolve:()=>'/v1/orders',
  production:{ticketStore:sharedStore,connectionBudget:sharedBudget}};
const refusal=(config:ProductionSocketConfig)=>{try{createPresentationRealtime(config);}catch(error){return (error as Error).message;}return 'STARTED';};

test('the presentation production profile starts with an https origin and shared admission',()=>{
  assert.deepEqual(presentationProductionRefusals(complete),[]);
  assert.equal(refusal(complete),'STARTED');
});

test('the presentation production profile refuses each missing condition by name and has no memory default',()=>{
  assert.equal(refusal({...complete,publicOrigin:'http://app.example.test'}),'PRODUCTION_PROFILE_REFUSED:HTTPS_PUBLIC_ORIGIN_REQUIRED');
  const processStore={issue:sharedStore.issue,consume:sharedStore.consume};
  assert.equal(refusal({...complete,production:{...complete.production,ticketStore:processStore}}),'PRODUCTION_PROFILE_REFUSED:SHARED_TICKET_STORE_REQUIRED');
  const processBudget:ConnectionBudget={reserve:sharedBudget.reserve,renew:sharedBudget.renew,release:sharedBudget.release};
  assert.equal(refusal({...complete,production:{...complete.production,connectionBudget:processBudget}}),'PRODUCTION_PROFILE_REFUSED:SHARED_CONNECTION_BUDGET_REQUIRED');
  assert.equal(refusal({...complete,production:{} as never}),'PRODUCTION_PROFILE_REFUSED:SHARED_TICKET_STORE_REQUIRED,SHARED_CONNECTION_BUDGET_REQUIRED');
});

test('the development profile is unchanged and still refused under NODE_ENV=production',()=>{
  const development={development:true as const,publicOrigin:'http://localhost:4401',bffOrigin:'http://127.0.0.1:4310',resolve:()=>'/v1/orders'};
  assert.doesNotThrow(()=>createPresentationRealtime(development));
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{assert.throws(()=>createPresentationRealtime(development),/DURABLE_REALTIME_PROFILE_REQUIRED/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
});

test('a ticket store over a durable vault is refused unless the vault is reached over TLS and with authentication',()=>{
  const over=(security:{durable:boolean;tls:boolean;authenticated:boolean})=>({...complete,production:{...complete.production,ticketStore:{...sharedStore,security}}});
  assert.equal(refusal(over({durable:true,tls:false,authenticated:true})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_TLS_REQUIRED');
  assert.equal(refusal(over({durable:true,tls:true,authenticated:false})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_AUTHENTICATION_REQUIRED');
  assert.equal(refusal(over({durable:true,tls:false,authenticated:false})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_TLS_REQUIRED,TICKET_STORE_AUTHENTICATION_REQUIRED');
  assert.equal(refusal(over({durable:true,tls:true,authenticated:true})),'STARTED');
});

test('a shared ticket store that declares nothing about its security is refused in production, not passed for lack of a claim',()=>{
  const using=(ticketStore:object)=>({...complete,production:{...complete.production,ticketStore:ticketStore as never}});
  const undeclared={shared:true as const,issue:sharedStore.issue,consume:sharedStore.consume};
  assert.deepEqual(presentationProductionRefusals(using(undeclared)),['TICKET_STORE_SECURITY_REQUIRED']);
  assert.equal(refusal(using(undeclared)),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_SECURITY_REQUIRED');
  // An empty or partial declaration says nothing about TLS and authentication either.
  assert.equal(refusal(using({...undeclared,security:{}})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_SECURITY_REQUIRED');
  assert.equal(refusal(using({...undeclared,security:{tls:true,authenticated:true}})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_SECURITY_REQUIRED');
  assert.equal(refusal(using({...undeclared,security:null})),'PRODUCTION_PROFILE_REFUSED:TICKET_STORE_SECURITY_REQUIRED');
  // A store that is not shared is refused for that, once; a complete declaration is accepted.
  assert.equal(refusal(using({issue:sharedStore.issue,consume:sharedStore.consume})),'PRODUCTION_PROFILE_REFUSED:SHARED_TICKET_STORE_REQUIRED');
  assert.equal(refusal(using({...undeclared,security:secured})),'STARTED');
  // The development profile keeps accepting a custom store that declares nothing.
  const development={development:true as const,publicOrigin:'http://localhost:4401',bffOrigin:'http://127.0.0.1:4310',resolve:()=>'/v1/orders',ticketStore:undeclared};
  assert.doesNotThrow(()=>createPresentationRealtime(development).close());
});

test('production admission answers 503 while the ticket store is unavailable and never falls back to memory',async()=>{
  const {createServer}=await import('node:http');
  let unavailable=true;
  const issued:string[]=[];
  const store={shared:true as const,security:secured,async issue(id:string){if(unavailable)throw new Error('STORE_UNAVAILABLE');issued.push(id);},async consume(){return undefined;}};
  const bff=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({subject:'person-1',tenant:null,roles:[],csrf:'csrf'}));});
  await new Promise<void>(resolve=>bff.listen(0,'127.0.0.1',resolve));
  const runtime=createPresentationRealtime({...complete,bffOrigin:'http://127.0.0.1:'+(bff.address() as {port:number}).port,production:{ticketStore:store,connectionBudget:sharedBudget}});
  const app=createServer((req,res)=>{void runtime.handleHttp(req,res);});
  await new Promise<void>(resolve=>app.listen(0,'127.0.0.1',resolve));
  try{
    const ask=()=>fetch('http://127.0.0.1:'+(app.address() as {port:number}).port+'/api/realtime/ticket',{method:'POST',headers:{origin:complete.publicOrigin,cookie:'app_session=opaque','x-csrf-token':'csrf'}});
    const refused=await ask();
    assert.equal(refused.status,503);
    assert.equal((await refused.json() as {title:string}).title,'AUTHORITY_UNAVAILABLE');
    assert.deepEqual(issued,[],'no ticket was kept anywhere');
    unavailable=false;
    const admitted=await ask();
    assert.equal(admitted.status,200);assert.equal(issued.length,1);
  }finally{
    runtime.close();
    for(const server of [app,bff]){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  }
});
