import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parsePageAccess,pickPageAccess,fieldState,accessReader,can,fieldAccess,type PageAccess} from '../src/index.js';

const valid=()=>({contextRef:'ctx-1',revision:'r7',expiresAt:1000,capabilities:{'orders.view':true,'orders.export':false},
  fields:{name:{view:true,edit:true},note:{view:true,edit:false},cost:{view:false,edit:false}}});

test('a valid snapshot is copied, frozen and read the same way as before',()=>{
  const result=parsePageAccess(valid(),{now:10});
  assert.equal(result.ok,true);if(!result.ok)return;
  assert.ok(Object.isFrozen(result.access)&&Object.isFrozen(result.access.capabilities)&&Object.isFrozen(result.access.fields));
  assert.equal(can(result.access,'orders.view',10),true);assert.equal(can(result.access,'orders.export',10),false);
  assert.deepEqual(fieldAccess(result.access,'note',10),{view:true,edit:false});
});

test('a validated or picked snapshot is made of plain objects, which a server component can pass to a client one',()=>{
  const result=parsePageAccess(valid(),{now:10});assert.ok(result.ok);
  const picked=pickPageAccess(result.access,{capabilities:['orders.view'],fields:['name']});
  for(const value of [result.access,result.access.capabilities,result.access.fields,result.access.fields.name,picked,picked.capabilities,picked.fields,picked.fields.name])
    assert.equal(Object.getPrototypeOf(value),Object.prototype);
  assert.deepEqual(parsePageAccess(JSON.parse('{"contextRef":"c","revision":"1","expiresAt":1000,"capabilities":{"__proto__":true},"fields":{}}'),{now:10}),{ok:false,reason:'MALFORMED'});
  assert.equal(can(result.access,'constructor',10),false);assert.equal(fieldAccess(result.access,'toString',10).view,false);
});

test('a malformed snapshot is refused whole: shape, references, expiry type, grants and fields',()=>{
  const cases:unknown[]=[undefined,null,'snapshot',[],new Date(),
    {...valid(),subject:'person-1'},{...valid(),accessToken:'opaque'},
    Object.fromEntries(Object.entries(valid()).filter(([key])=>key!=='revision')),
    {...valid(),contextRef:''},{...valid(),contextRef:'x'.repeat(129)},{...valid(),contextRef:'has space'},{...valid(),contextRef:7},
    {...valid(),revision:''},{...valid(),revision:null},
    {...valid(),expiresAt:'1000'},{...valid(),expiresAt:Number.NaN},{...valid(),expiresAt:Infinity},
    {...valid(),capabilities:{'orders.view':'true'}},{...valid(),capabilities:{'orders view':true}},{...valid(),capabilities:[true]},
    {...valid(),fields:{name:{view:true}}},{...valid(),fields:{name:{view:true,edit:true,admin:true}}},{...valid(),fields:{name:true}},
    {...valid(),capabilities:Object.fromEntries(Array.from({length:4097},(_,index)=>['key'+index,true]))},
  ];
  for(const value of cases)assert.deepEqual(parsePageAccess(value,{now:10}),{ok:false,reason:'MALFORMED'},JSON.stringify(value)?.slice(0,80));
});

test('an expired snapshot, a snapshot of another context and a snapshot with an unknown key are refused',()=>{
  assert.deepEqual(parsePageAccess(valid(),{now:1000}),{ok:false,reason:'EXPIRED'});
  assert.deepEqual(parsePageAccess(valid(),{now:10,contextRef:'ctx-2'}),{ok:false,reason:'CONTEXT_MISMATCH'});
  assert.equal(parsePageAccess(valid(),{now:10,contextRef:'ctx-1'}).ok,true);
  const keys={capabilities:['orders.view','orders.export'],fields:['name','note','cost']};
  assert.equal(parsePageAccess(valid(),{now:10,keys}).ok,true);
  assert.deepEqual(parsePageAccess(valid(),{now:10,keys:{...keys,capabilities:['orders.view']}}),{ok:false,reason:'UNKNOWN_KEY'});
  assert.deepEqual(parsePageAccess(valid(),{now:10,keys:{...keys,fields:['name']}}),{ok:false,reason:'UNKNOWN_KEY'});
});

test('a picked snapshot holds only the listed keys and never grants a key the snapshot lacks',()=>{
  const parsed=parsePageAccess(valid(),{now:10});assert.ok(parsed.ok);
  const picked=pickPageAccess(parsed.access,{capabilities:['orders.view','orders.delete'],fields:['note','address']});
  assert.deepEqual(Object.keys(picked.capabilities),['orders.view']);assert.deepEqual(Object.keys(picked.fields),['note']);
  assert.equal(can(picked,'orders.delete',10),false);assert.equal(fieldAccess(picked,'name',10).view,false);
  assert.equal(picked.contextRef,'ctx-1');assert.equal(picked.revision,'r7');assert.equal(picked.expiresAt,1000);
});

test('a field is hidden, disabled or enabled, and a disabled or busy control stays disabled',()=>{
  const parsed=parsePageAccess(valid(),{now:10});assert.ok(parsed.ok);const access:PageAccess=parsed.access;
  assert.equal(fieldState(access,'name',{},10),'enabled');
  assert.equal(fieldState(access,'note',{},10),'disabled');
  assert.equal(fieldState(access,'cost',{},10),'hidden');
  assert.equal(fieldState(access,'unknown',{},10),'hidden');
  assert.equal(fieldState(access,'name',{disabled:true},10),'disabled');
  assert.equal(fieldState(access,'name',{busy:true},10),'disabled');
  assert.equal(fieldState(access,'name',{},1000),'hidden');
  assert.equal(fieldState(undefined,'name',{},10),'hidden');
});

test('a reader without a snapshot closes every entry, and a reader reads the time at each call',()=>{
  const closed=accessReader(undefined);
  assert.equal(closed.can('orders.view'),false);assert.equal(closed.field('name').view,false);assert.equal(closed.fieldState('name'),'hidden');
  assert.deepEqual(closed.patch({name:'a'},{name:'a'}),{});
  assert.throws(()=>closed.patch({name:'a'},{name:'b'}),/FORBIDDEN_FIELD/);
  const parsed=parsePageAccess(valid(),{now:10});assert.ok(parsed.ok);
  let now=10;const reader=accessReader(parsed.access,()=>now);
  assert.equal(reader.can('orders.view'),true);assert.deepEqual(reader.patch({name:'a',note:'n'},{name:'b',note:'n'}),{name:'b'});
  assert.throws(()=>reader.patch({note:'n'},{note:'changed'}),/FORBIDDEN_FIELD/);
  now=1000;
  assert.equal(reader.can('orders.view'),false);assert.equal(reader.fieldState('name'),'hidden');
});
