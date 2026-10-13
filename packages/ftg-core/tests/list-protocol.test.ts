import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkListProtocol,listSearchParams,listPage,type ListProtocol,type OpenApiDocument} from '../src/index.js';import {validListState} from '../src/internal.js';

const contract=(parameters:unknown[],overrides:Record<string,unknown>={}):OpenApiDocument=>({openapi:'3.1.0',paths:{'/orders':{get:{operationId:'listOrders',parameters,
  responses:{'200':{content:{'application/json':{schema:{type:'object',properties:{
    data:{type:'object',properties:{rows:{type:'array',items:{$ref:'#/components/schemas/Order'}}}},
    meta:{type:'object',properties:{count:{type:'integer'}}}}}}}}},...overrides}}},
  components:{schemas:{Order:{type:'object',properties:{name:{type:'string'},total:{type:'number'}}}},
    parameters:{Size:{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:50}}}}} as OpenApiDocument);
const declared=[{name:'p',in:'query',schema:{type:'integer',minimum:0}},{$ref:'#/components/parameters/Size'},
  {name:'order',in:'query',schema:{type:'string',enum:['name,asc','name,desc','total,asc','total,desc']}},
  {name:'q',in:'query',schema:{type:'string',maxLength:80}}];
const protocol:ListProtocol={operationId:'listOrders',page:{param:'p',encoding:'number',first:0},size:{param:'limit',max:50},
  sort:{param:'order',fields:['name','total'],encoding:'field,direction'},filters:{search:{param:'q',maxLength:80,field:'name'}},
  rows:['data','rows'],total:['meta','count']};

test('a protocol that the operation declares passes the check',()=>{
  assert.deepEqual(checkListProtocol(contract(declared),protocol),[]);
});

test('a parameter the operation does not declare is refused, so none is invented',()=>{
  assert.deepEqual(checkListProtocol(contract(declared.filter(parameter=>(parameter as {name?:string}).name!=='q')),protocol),['UNDECLARED_PARAMETER:q']);
  assert.deepEqual(checkListProtocol(contract([]),{...protocol,sort:undefined,filters:undefined}),['UNDECLARED_PARAMETER:p','UNDECLARED_PARAMETER:limit']);
  assert.deepEqual(checkListProtocol(contract(declared.map(parameter=>(parameter as {name?:string}).name==='q'?{...parameter,in:'header'}:parameter)),protocol),['UNDECLARED_PARAMETER:q']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,operationId:'missing'}),['UNKNOWN_OPERATION:missing']);
});

test('types, limits, sort values and required parameters are checked against the operation',()=>{
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,size:{param:'limit',max:100}}),['SIZE_ABOVE_MAXIMUM']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,page:{param:'p',encoding:'number',first:1}}),[]);
  assert.deepEqual(checkListProtocol(contract(declared.map(parameter=>(parameter as {name?:string}).name==='p'?{...parameter,schema:{type:'integer',minimum:1}}:parameter)),protocol),['PAGE_BELOW_MINIMUM']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,filters:{search:{param:'q',maxLength:200,field:'name'}}}),['FILTER_ABOVE_MAXIMUM:search']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,sort:{param:'order',fields:['name'],encoding:'signed'}}),['SORT_VALUE_NOT_ALLOWED:name','SORT_VALUE_NOT_ALLOWED:-name']);
  assert.deepEqual(checkListProtocol(contract(declared.map(parameter=>(parameter as {name?:string}).name==='q'?{...parameter,schema:{type:'integer'}}:parameter)),protocol),['PARAMETER_TYPE:q']);
  assert.deepEqual(checkListProtocol(contract([...declared,{name:'tenant',in:'query',required:true,schema:{type:'string'}}]),protocol),['REQUIRED_PARAMETER_NOT_SENT:tenant']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,filters:{search:{param:'q',maxLength:80},other:{param:'q',maxLength:80}}}),['DUPLICATE_PARAMETER:q']);
});

test('the rows, the total and the fields of a sort or a filter must be where the protocol says',()=>{
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,rows:['data'],total:['meta','missing']}),['ROWS_NOT_ARRAY','TOTAL_NOT_INTEGER']);
  assert.deepEqual(checkListProtocol(contract(declared),{...protocol,sort:{param:'order',fields:['name','cost'],encoding:'field,direction'},filters:{search:{param:'q',maxLength:80,field:'note'}}}),
    ['SORT_VALUE_NOT_ALLOWED:cost,asc','SORT_VALUE_NOT_ALLOWED:cost,desc','SORT_FIELD_NOT_IN_ROWS:cost','FILTER_FIELD_NOT_IN_ROWS:search']);
});

test('a request sends only the declared parameters, encoded the backend way',()=>{
  assert.equal(listSearchParams(protocol,{page:3,size:20,sort:{field:'total',direction:'desc'},filters:{search:'blue'}}).toString(),'p=2&limit=20&order=total%2Cdesc&q=blue');
  assert.equal(listSearchParams(protocol,{page:1,size:10,filters:{search:''}}).toString(),'p=0&limit=10');
  assert.equal(listSearchParams({...protocol,page:{param:'offset',encoding:'offset'},sort:{param:'sort',fields:['name'],encoding:'signed'}},{page:3,size:20,sort:{field:'name',direction:'desc'}}).toString(),'offset=40&limit=20&sort=-name');
  assert.equal(listSearchParams({...protocol,sort:{param:'by',fields:['name'],encoding:'separate',directionParam:'dir'}},{page:1,size:5,sort:{field:'name',direction:'asc'}}).toString(),'p=0&limit=5&by=name&dir=asc');
  for(const state of [{page:0,size:10},{page:1,size:51},{page:1.5,size:10},{page:1,size:10,sort:{field:'cost',direction:'asc' as const}},
    {page:1,size:10,filters:{unknown:'x'}},{page:1,size:10,filters:{search:'x'.repeat(81)}}]){
    assert.equal(validListState(protocol,state),false);assert.throws(()=>listSearchParams(protocol,state),/INVALID_LIST_STATE/);
  }
});

test('the rows and the total are read where the protocol says, or the answer is refused',()=>{
  assert.deepEqual(listPage(protocol,{data:{rows:[{name:'a'}]},meta:{count:7}}),{rows:[{name:'a'}],total:7});
  assert.deepEqual(listPage({...protocol,total:undefined},{data:{rows:[]}}),{rows:[],total:undefined});
  for(const body of [null,{data:{rows:{}}},{data:{rows:[]},meta:{count:-1}},{data:{rows:[]},meta:{count:'7'}},{data:{rows:[]}}])
    assert.throws(()=>listPage(protocol,body),/INVALID_LIST_RESPONSE/);
});
