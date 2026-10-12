import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {ListProtocol} from '@mpfrontend/ftg-core';
import {inScope,listUrlState,scopedQueryKey} from '../src/shared.js';

const protocol:ListProtocol={operationId:'listOrders',page:{param:'p',encoding:'number',first:0},size:{param:'limit',max:50},
  sort:{param:'order',fields:['name','total'],encoding:'field,direction'},
  filters:{search:{param:'q',maxLength:20},owner:{param:'owner',maxLength:20,field:'owner'}},rows:['rows'],total:['count']};
const urlState=listUrlState(protocol,{size:10,sizes:[10,25,50],sort:{field:'name',direction:'asc'}});

test('a query key is made of the scope, the operation and its parameters',()=>{
  const scope={contextRef:'ctx-1',revision:'r1'};
  const key=scopedQueryKey(scope,'orders.list',{page:2});
  assert.deepEqual(key,['mpfrontend-scoped','ctx-1','r1','orders.list',{page:2}]);
  assert.deepEqual(scopedQueryKey(scope,'orders.list'),key.slice(0,4));
  assert.equal(inScope(key,scope),true);
  assert.equal(inScope(key,{contextRef:'ctx-1',revision:'r2'}),false);
  assert.equal(inScope(key,{contextRef:'ctx-2',revision:'r1'}),false);
  assert.equal(inScope(key,undefined),false);assert.equal(inScope(['orders.list'],scope),false);
});

test('the URL state has typed keys with defaults, and the server and the browser read a URL the same way',()=>{
  assert.deepEqual(urlState.defaults,{page:1,size:10,sort:{field:'name',direction:'asc'},filters:{search:'',owner:''}});
  const state={page:3,size:25,sort:{field:'total',direction:'desc'} as const,filters:{search:'blue',owner:''}};
  const query=urlState.serialize(state);
  assert.equal(query,'?page=3&size=25&sort=total.desc&search=blue');
  assert.deepEqual(urlState.read(query),state);
  assert.deepEqual(urlState.read(new URLSearchParams(query.slice(1))),state);
  assert.deepEqual(urlState.read({page:'3',size:'25',sort:'total.desc',search:'blue'}),state);
  assert.equal(urlState.serialize(urlState.defaults),'');
});

test('an invalid value falls back to its default',()=>{
  for(const [search,expected] of [
    ['page=0',{page:1}],['page=x',{page:1}],['page=1.5',{page:1}],['page=100001',{page:1}],['page=-2',{page:1}],
    ['size=7',{size:10}],['size=60',{size:10}],['sort=cost.asc',{sort:{field:'name',direction:'asc'}}],['sort=name.up',{sort:{field:'name',direction:'asc'}}],
    ['search='+'x'.repeat(21),{filters:{search:'',owner:''}}],
  ] as const)assert.deepEqual({...urlState.read(search),...expected},urlState.read(search),search);
  assert.deepEqual(urlState.read('page=0&size=7&sort=x&search='+'x'.repeat(21)),urlState.defaults);
  assert.deepEqual(urlState.read('unknown=1&tenant=ctx-1'),urlState.defaults,'a key the state does not declare is not read');
});

test('a sort or a filter on a field the person may not view is dropped',()=>{
  const canView=(field:string)=>field==='name';
  assert.deepEqual(urlState.read('sort=total.desc&owner=me&search=blue',{canView}),{page:1,size:10,sort:undefined,filters:{search:'blue',owner:''}});
  assert.deepEqual(urlState.hidden(urlState.parsers.sort?{sort:{field:'total',direction:'desc'},owner:'me'}:{},canView),['sort','owner']);
  assert.deepEqual(urlState.hidden({sort:{field:'name',direction:'asc'},owner:''},canView),[]);
});

test('the scope never enters the URL: only page, size, sort and the declared filters are keys',()=>{
  assert.deepEqual(Object.keys(urlState.parsers).sort(),['owner','page','search','size','sort']);
  const query=urlState.serialize({page:2,size:10,filters:{search:'a',owner:'b'}});
  assert.doesNotMatch(query,/ctx|revision|contextRef|scope/);
});

test('a default the protocol does not allow and a filter named like a reserved key are refused',()=>{
  assert.throws(()=>listUrlState(protocol,{size:100}),/INVALID_LIST_DEFAULT/);
  assert.throws(()=>listUrlState(protocol,{size:10,sizes:[10,80]}),/INVALID_LIST_DEFAULT/);
  assert.throws(()=>listUrlState(protocol,{size:10,sort:{field:'cost',direction:'asc'}}),/INVALID_LIST_DEFAULT/);
  assert.throws(()=>listUrlState({...protocol,filters:{page:{param:'q',maxLength:5}}},{size:10}),/RESERVED_OR_INVALID_URL_KEY:page/);
  const noSort=listUrlState({...protocol,sort:undefined},{size:10});
  assert.deepEqual(noSort.read('sort=name.asc'),{page:1,size:10,sort:undefined,filters:{search:'',owner:''}});
});
