import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAccessLoader,clientSnapshot} from '../src/server.js';
import {appRoutes} from '../src/testing.js';

const keys={capabilities:['orders.view','orders.export'],fields:['total','note']};
const snapshot=(overrides:Record<string,unknown>={})=>({contextRef:'ctx-1',revision:'r1',expiresAt:2000,
  capabilities:{'orders.view':true,'orders.export':false},fields:{total:{view:true,edit:false},note:{view:true,edit:true}},...overrides});
const loader=(load:(request:object,signal:AbortSignal)=>Promise<unknown>,contextRef:(request:object)=>string|undefined=()=>'ctx-1',timeoutMs=1000)=>
  createAccessLoader({load,contextRef,keys,timeoutMs,now:()=>1000});

test('the loader validates the snapshot and memoizes it once per request object',async()=>{
  let loads=0;const read=loader(async()=>{loads++;return snapshot();});
  const request={},other={};
  const [first,second]=await Promise.all([read(request),read(request)]);
  assert.equal(first,second);assert.equal(loads,1);assert.equal(first.ok,true);
  await read(other);assert.equal(loads,2,'another request loads again');
});

// A load that never answers must end within its own bound; the test bound stops a loader that waits forever.
test('a malformed, expired, mismatched or unknown-key snapshot, a failed load and a slow load grant nothing',{timeout:5000},async()=>{
  const cases:Array<[ReturnType<typeof loader>,string]>=[
    [loader(async()=>({...snapshot(),subject:'person-1'})),'MALFORMED'],
    [loader(async()=>snapshot({expiresAt:1000})),'EXPIRED'],
    [loader(async()=>snapshot(),()=>'ctx-2'),'CONTEXT_MISMATCH'],
    [loader(async()=>snapshot(),()=>undefined),'CONTEXT_MISMATCH'],
    [loader(async()=>snapshot({capabilities:{'orders.delete':true}})),'UNKNOWN_KEY'],
    [loader(async()=>{throw new Error('upstream 500');}),'UNAVAILABLE'],
    [loader(()=>new Promise(()=>undefined),()=>'ctx-1',20),'UNAVAILABLE'],
  ];
  for(const [read,reason] of cases)assert.deepEqual(await read({}),{ok:false,reason},reason);
  assert.throws(()=>createAccessLoader({load:async()=>snapshot(),contextRef:()=>'ctx-1',keys,timeoutMs:0}),/ACCESS_LOAD_TIMEOUT_REQUIRED/);
});

test('the load receives an abort signal bounded by the timeout',{timeout:5000},async()=>{
  let seen:AbortSignal|undefined;
  const read=loader((_,signal)=>{seen=signal;return new Promise(()=>undefined);},()=>'ctx-1',20);
  assert.deepEqual(await read({}),{ok:false,reason:'UNAVAILABLE'});assert.equal(seen?.aborted,true);
});

test('the client receives only the keys its components need, and nothing for a refused snapshot',async()=>{
  const result=await loader(async()=>snapshot())({});
  assert.deepEqual(JSON.parse(JSON.stringify(clientSnapshot(result,{capabilities:['orders.view'],fields:['note']}))),
    {contextRef:'ctx-1',revision:'r1',expiresAt:2000,capabilities:{'orders.view':true},fields:{note:{view:true,edit:true}}});
  assert.equal(clientSnapshot({ok:false,reason:'EXPIRED'},keys),null);
});

test('a browser bundle resolves the server entry to a module that refuses to load',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')) as {exports:Record<string,Record<string,string>>};
  const server=manifest.exports['./server']!;
  assert.deepEqual(Object.keys(server),['types','browser','import']);
  assert.equal(server.browser,'./dist/browser-refusal.js');assert.equal(server.import,'./dist/server.js');
  await assert.rejects(import('../src/browser-refusal.js'),/ACCESS_SERVER_ENTRY_IN_BROWSER/);
  assert.doesNotMatch(await readFile(new URL('../src/server.ts',import.meta.url),'utf8'),/from 'react'|use client/);
});

test('the route list of an app folder skips route groups, private folders and parallel slots',async()=>{
  const app=await mkdtemp(join(tmpdir(),'mpfrontend-access-routes-'));
  try{
    for(const path of ['page.tsx','orders/page.tsx','orders/[position]/page.tsx','(admin)/audit/page.tsx','_parts/page.tsx','@modal/page.tsx','api/transfer/route.ts','orders/layout.tsx']){
      await mkdir(join(app,path,'..'),{recursive:true});await writeFile(join(app,path),'');
    }
    assert.deepEqual(await appRoutes(app),['/','/audit','/orders','/orders/[position]']);
  }finally{await rm(app,{recursive:true,force:true});}
});
