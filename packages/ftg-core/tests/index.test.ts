import { test } from 'node:test';import assert from 'node:assert/strict';import { normalizeResources,normalizeRequests,validateRead,type OpenApiDocument } from '../src/index.js';
const document:OpenApiDocument={openapi:'3.1.0',paths:{'/items':{get:{operationId:'list',responses:{'200':{content:{'application/json':{schema:{type:'array',items:{$ref:'#/components/schemas/Item'}}}}}}}}},components:{schemas:{Item:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',readOnly:true},name:{type:['string','null']},secret:{type:'string',writeOnly:true}}}}}};
test('normalization follows explicit operation/ref and excludes write-only data',()=>{const resources=normalizeResources(document,[{name:'items',operationId:'list'}]);assert.deepEqual(resources[0]?.fields.map(f=>f.key),['id','name']);assert.equal(resources[0]?.fields[0]?.editable,false);assert.equal(resources[0]?.fields[1]?.nullable,true);});
test('duplicate operation IDs and unsupported unions fail',()=>{const duplicate=structuredClone(document);duplicate.paths['/other']=duplicate.paths['/items']!;assert.throws(()=>normalizeResources(duplicate,[]),/DUPLICATE/);const union=structuredClone(document);union.components!.schemas!.Item!.properties!.name={oneOf:[{type:'string'},{type:'number'}]};assert.throws(()=>normalizeResources(union,[{name:'items',operationId:'list'}]),/UNION/);});
test('runtime schema validation rejects malformed and extra fields',()=>{const schema=document.components!.schemas!.Item!;assert.equal(validateRead({id:'x',name:null},schema,document),true);assert.equal(validateRead({id:3},schema,document),false);assert.equal(validateRead({id:'x',extra:'leak'},schema,document),false);});
test('response metadata never grants editability, including ordinary fields without readOnly annotations',()=>{
  const resource=normalizeResources(document,[{name:'items',operationId:'list'}])[0]!;
  assert.equal(resource.fields.find(field=>field.key==='name')!.editable,false);
});
test('request selection is explicit and excludes referenced read-only fields but includes write-only inputs',()=>{
  const doc=structuredClone(document);
  doc.paths['/items']!.post={operationId:'create',requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/Item'}}}},responses:{'201':{description:'Created'}}};
  const fields=normalizeRequests(doc,[{name:'create-item',operationId:'create'}])[0]!.fields;
  assert.deepEqual(fields.map(field=>field.key),['name','secret']);assert.equal(fields.every(field=>field.editable),true);
  assert.throws(()=>normalizeRequests(doc,[{name:'read-as-write',operationId:'list'}]),/MUTATION/);
  assert.throws(()=>normalizeRequests(doc,[{name:'missing',operationId:'unknown'}]),/UNKNOWN_OPERATION/);
  const body=(doc.paths['/items']!.post as {requestBody:{required:boolean}}).requestBody;body.required=false;
  assert.throws(()=>normalizeRequests(doc,[{name:'create-item',operationId:'create'}]),/OPTIONAL_REQUEST_BODY/);
});
test('a bodyless mutation requires explicit selection and refuses a present requestBody',()=>{
  const doc=structuredClone(document);doc.paths['/items']!.delete={operationId:'remove',responses:{'200':{description:'Removed'}}};
  const selection={name:'remove-item',operationId:'remove',body:'none'} as Parameters<typeof normalizeRequests>[1][number];
  const request=normalizeRequests(doc,[selection])[0]!;
  assert.equal((request as {body?:string}).body,'none');assert.deepEqual(request.fields,[]);assert.equal('schema' in request,false);
  assert.throws(()=>normalizeRequests(doc,[{name:'remove-item',operationId:'remove'}]),/MISSING_JSON_REQUEST/);
  doc.paths['/items']!.delete={operationId:'remove',requestBody:{required:false,content:{'application/json':{schema:{type:'object',properties:{note:{type:'string'}}}}}},responses:{'200':{description:'Removed'}}};
  assert.throws(()=>normalizeRequests(doc,[selection]),/BODY_PROFILE_MISMATCH/);
});
test('an optional JSON mutation requires explicit selection and preserves absent, null and object semantics',()=>{
  const doc=structuredClone(document);
  doc.components!.schemas!.CancelRequest={type:'object',additionalProperties:false,required:['note'],properties:{note:{type:['string','null']}}};
  doc.paths['/items']!.post={operationId:'cancel',requestBody:{required:false,content:{'application/json':{schema:{oneOf:[{type:'null'},{$ref:'#/components/schemas/CancelRequest'}]}}}},responses:{'200':{description:'Cancelled'}}};
  const selection={name:'cancel-item',operationId:'cancel',body:'optional-json'} as Parameters<typeof normalizeRequests>[1][number];
  const request=normalizeRequests(doc,[selection])[0]!;
  assert.equal((request as {body?:string}).body,'optional-json');assert.deepEqual(request.fields.map(field=>field.key),['note']);
  assert.throws(()=>normalizeRequests(doc,[{name:'cancel-item',operationId:'cancel'}]),/OPTIONAL_REQUEST_BODY_NOT_SUPPORTED/);
  assert.throws(()=>normalizeRequests(doc,[{...selection,body:'none'} as Parameters<typeof normalizeRequests>[1][number]]),/BODY_PROFILE_MISMATCH/);
  (doc.paths['/items']!.post as {requestBody:{required:boolean}}).requestBody.required=true;
  assert.throws(()=>normalizeRequests(doc,[selection]),/OPTIONAL_REQUEST_BODY_PROFILE_MISMATCH/);
  (doc.paths['/items']!.post as {requestBody:{required:boolean;content:Record<string,{schema:unknown}>}}).requestBody={required:false,content:{'application/json':{schema:{type:['object','null'],additionalProperties:false,required:['note'],properties:{note:{type:['string','null']}}}}}};
  assert.deepEqual(normalizeRequests(doc,[selection])[0]!.fields.map(field=>field.key),['note']);
});
test('an empty 204 response requires an explicit body profile and rejects content or response paths',()=>{
  const doc=structuredClone(document);
  doc.paths['/items']!.post={operationId:'report',responses:{'204':{description:'No Content'}}};
  const selection={name:'reported',operationId:'report',responseStatus:'204',body:'none'} as Parameters<typeof normalizeResources>[1][number];
  const resource=normalizeResources(doc,[selection])[0]!;
  assert.equal((resource as {body?:string}).body,'none');assert.equal(resource.responseStatus,'204');
  assert.deepEqual(resource.fields,[]);assert.equal('schema' in resource,false);
  assert.throws(()=>normalizeResources(doc,[{name:'reported',operationId:'report',responseStatus:'204'} as Parameters<typeof normalizeResources>[1][number]]),/RESPONSE_BODY_PROFILE_MISMATCH/);
  assert.throws(()=>normalizeResources(doc,[{...selection,responseStatus:'200'} as Parameters<typeof normalizeResources>[1][number]]),/EMPTY_RESPONSE_REQUIRES_204/);
  assert.throws(()=>normalizeResources(doc,[{...selection,responsePath:['value']} as Parameters<typeof normalizeResources>[1][number]]),/EMPTY_RESPONSE_PATH_NOT_SUPPORTED/);
  doc.paths['/items']!.post={operationId:'report',responses:{'204':{description:'No Content',content:{'application/json':{schema:{type:'object',properties:{}}}}}}};
  assert.throws(()=>normalizeResources(doc,[selection]),/RESPONSE_BODY_PROFILE_MISMATCH/);
});
