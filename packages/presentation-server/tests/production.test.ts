import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPresentationRealtime,presentationProductionRefusals,type AdmissionTicket,type ConnectionBudget,type ProductionSocketConfig} from '../src/index.js';

const records=new Map<string,AdmissionTicket>();
const sharedStore={shared:true as const,async issue(id:string,ticket:AdmissionTicket){records.set(id,ticket);},async consume(id:string){const value=records.get(id);records.delete(id);return value;}};
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
