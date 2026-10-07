import {createRequire} from 'node:module';
import type {OpenApiDocument,JsonSchema,ResourceSelection,RequestModel} from '@mpfrontend/ftg-core';
import {resolveSchema} from '@mpfrontend/ftg-core';
import type {Ajv2020} from 'ajv/dist/2020.js';

const require=createRequire(import.meta.url);
const Ajv=require('ajv/dist/2020').Ajv2020 as typeof Ajv2020;
const addFormats=require('ajv-formats') as typeof import('ajv-formats').default;
const standalone=require('ajv/dist/standalone').default as typeof import('ajv/dist/standalone/index.js').default;
type Schema=JsonSchema&Record<string,unknown>;
const annotations=new Set(['title','description','readOnly','writeOnly']);

function resolved(raw:JsonSchema,document:OpenApiDocument):Schema{
  if(raw.$ref&&Object.keys(raw).some(key=>key!=='$ref'&&!annotations.has(key)))throw new Error('UNSUPPORTED_SCHEMA_REFERENCE_SIBLINGS');
  const value=resolveSchema(raw,document) as Schema;
  return {...value,...(raw.readOnly!==undefined?{readOnly:raw.readOnly}:{}),...(raw.writeOnly!==undefined?{writeOnly:raw.writeOnly}:{})};
}

// Finite read-model subset: never guess composition, recursive types or field transforms.
function readShape(raw:JsonSchema,document:OpenApiDocument,depth=0,direction:'read'|'request'='read'):Schema{
  if(depth>32)throw new Error('UNSUPPORTED_RECURSIVE_READ_SCHEMA');
  const schema=resolved(raw,document);
  if(schema.oneOf||schema.anyOf||schema.allOf)throw new Error('UNSUPPORTED_READ_SCHEMA_UNION');
  const next={...schema};
  delete next.readOnly;delete next.writeOnly;
  if(direction==='request'&&(schema.type==='object'||Array.isArray(schema.type)&&schema.type.includes('object'))&&schema.additionalProperties!==false)
    throw new Error('REQUEST_OBJECT_MUST_DECLARE_CLOSED_PROPERTIES');
  const excluded=(child:JsonSchema)=>direction==='read'?resolved(child,document).writeOnly:resolved(child,document).readOnly;
  if(schema.properties){
    next.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,child])=>[key,
      excluded(child)?{not:{}}:readShape(child,document,depth+1,direction)])) as Record<string,JsonSchema>;
    if(schema.required)next.required=schema.required.filter(key=>!excluded(schema.properties![key]??{}));
  }
  if(schema.items)next.items=readShape(schema.items,document,depth+1,direction);
  if(typeof schema.additionalProperties==='object')next.additionalProperties=readShape(schema.additionalProperties,document,depth+1,direction);
  return next;
}

function readType(raw:JsonSchema,document:OpenApiDocument,depth=0,direction:'read'|'request'='read'):string{
  if(depth>32)throw new Error('UNSUPPORTED_RECURSIVE_READ_SCHEMA');
  const schema=resolved(raw,document);
  if(schema.oneOf||schema.anyOf||schema.allOf)throw new Error('UNSUPPORTED_READ_SCHEMA_UNION');
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const effective=types.filter(type=>type!=='null');
  if(effective.length!==1)throw new Error('UNSUPPORTED_READ_SCHEMA_TYPE');
  let type:string;
  if(schema.enum){
    if(!schema.enum.length||schema.enum.some(value=>value!==null&&!['string','number','boolean'].includes(typeof value)))throw new Error('UNSUPPORTED_READ_ENUM');
    type=schema.enum.map(value=>JSON.stringify(value)).join(' | ');
  }else switch(effective[0]){
    case 'string':case 'boolean':type=effective[0];break;
    case 'number':case 'integer':type='number';break;
    case 'array':
      if(!schema.items)throw new Error('MISSING_ARRAY_ITEMS');
      type='Array<'+readType(schema.items,document,depth+1,direction)+'>';break;
    case 'object':{
      const properties=Object.entries(schema.properties??{}).sort(([a],[b])=>a.localeCompare(b,'en'))
        .filter(([,child])=>direction==='read'?!resolved(child,document).writeOnly:!resolved(child,document).readOnly);
      type='{ '+properties.map(([key,child])=>'readonly '+JSON.stringify(key)+(schema.required?.includes(key)?'':'?')+': '+readType(child,document,depth+1,direction)).join('; ')+' }';
      if(typeof schema.additionalProperties==='object'){
        // Mixed fixed/index signatures can be incompatible in TypeScript; do not invent an intersection.
        if(properties.length)throw new Error('UNSUPPORTED_MIXED_READ_INDEX_SIGNATURE');
        type='Record<string, '+readType(schema.additionalProperties,document,depth+1,direction)+'>';
      }else if(schema.additionalProperties!==false)type+=' & Record<string, unknown>';
      break;
    }
    default:throw new Error('UNSUPPORTED_READ_SCHEMA_TYPE');
  }
  return !schema.enum&&(schema.nullable||types.includes('null'))?type+' | null':type;
}

function fullResponse(document:OpenApiDocument,selection:ResourceSelection):{body:'none'}|{body:'json';schema:JsonSchema}{
  const status=selection.responseStatus??'200';
  if((selection as {body?:unknown}).body!==undefined&&(selection as {body?:unknown}).body!=='none')throw new Error('UNSUPPORTED_RESPONSE_BODY_PROFILE');
  if((selection as {body?:unknown}).body==='none'){
    if(status!=='204')throw new Error('EMPTY_RESPONSE_REQUIRES_204');
    if((selection as {responsePath?:readonly string[]}).responsePath?.length)throw new Error('EMPTY_RESPONSE_PATH_NOT_SUPPORTED');
  }else if(status==='204')throw new Error('RESPONSE_BODY_PROFILE_MISMATCH');
  else if(!['200','201','202'].includes(status))throw new Error('UNSUPPORTED_JSON_SUCCESS_STATUS');
  for(const item of Object.values(document.paths))for(const[method,value]of Object.entries(item)){
    if(!['get','post','put','patch','delete','head','options'].includes(method))continue;
    const operation=value as {operationId?:string;responses?:Record<string,{content?:Record<string,{schema?:JsonSchema}>}>};
    if(operation.operationId===selection.operationId){
      const response=operation.responses?.[status];
      if((selection as {body?:unknown}).body==='none'){
        if(!response)throw new Error('MISSING_EMPTY_RESPONSE');
        if(Object.hasOwn(response,'content'))throw new Error('RESPONSE_BODY_PROFILE_MISMATCH');
        return {body:'none'};
      }
      const schema=response?.content?.['application/json']?.schema;
      if(schema)return {body:'json',schema};
    }
  }
  throw new Error((selection as {body?:unknown}).body==='none'?'MISSING_EMPTY_RESPONSE':'MISSING_JSON_RESPONSE');
}

export function readModelOutputs(document:OpenApiDocument,selections:readonly ResourceSelection[]):Record<string,string>{
  if(!document.openapi.startsWith('3.1.'))throw new Error('READ_MODELS_REQUIRE_OPENAPI_3_1');
  const ajv=new Ajv({strict:true,allErrors:false,code:{source:true},coerceTypes:false,useDefaults:false,removeAdditional:false});
  addFormats(ajv);
  const mapping:Record<string,string>={},types:string[]=[],validators:string[]=[],bodyless:string[]=[];
  for(const selection of selections){
    const response=fullResponse(document,selection);
    validators.push('  readonly '+JSON.stringify(selection.name)+': (value: unknown) => boolean;');
    if(response.body==='none'){
      types.push('  '+JSON.stringify(selection.name)+': undefined;');
      bodyless.push('exports['+JSON.stringify(selection.name)+'] = value => value === undefined;');
      continue;
    }
    const id='urn:mpfrontend:read:'+selection.name;
    types.push('  '+JSON.stringify(selection.name)+': '+readType(response.schema,document)+';');
    ajv.addSchema({...readShape(response.schema,document),$id:id});mapping[selection.name]=id;
  }
  return {
    'read-models.gen.ts':selections.length?'import validators from "./read-validators.gen.cjs";\nexport type ReadModels = {\n'+types.join('\n')+'\n};\n'+
      'export function parseRead<K extends keyof ReadModels>(resource: K, value: unknown): ReadModels[K] {\n'+
      '  if (!Object.hasOwn(validators, resource) || !validators[resource](value)) throw new Error("INVALID_API_RESPONSE");\n'+
      '  return value as ReadModels[K];\n}\n':
      'export type ReadModels = Record<never, never>;\nexport function parseRead(resource: never, value: unknown): never {\n  void resource; void value; throw new Error("INVALID_API_RESPONSE");\n}\n',
    'read-validators.gen.cjs':standalone(ajv,mapping)+(bodyless.length?'\n'+bodyless.join('\n')+'\n':''),
    'read-validators.gen.d.cts':validators.length?'declare const validators: {\n'+validators.join('\n')+'\n};\nexport = validators;\n':'declare const validators: Record<string, never>;\nexport = validators;\n'
  };
}
function optionalJsonBranches(raw:JsonSchema,document:OpenApiDocument):{schema:Schema;nonNull:JsonSchema|null}{
  const schema=resolved(raw,document);
  if(!schema.oneOf)return {schema,nonNull:null};
  if(schema.anyOf||schema.allOf||schema.oneOf.length!==2)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  const branches=schema.oneOf.map(branch=>resolved(branch,document));
  const nulls=branches.filter(branch=>branch.type==='null');
  if(nulls.length!==1)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  const nonNull=branches.find(branch=>branch.type!=='null');
  if(!nonNull||nonNull.oneOf||nonNull.anyOf||nonNull.allOf)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  return {schema,nonNull};
}

// Explicit required JSON, optional JSON or explicitly selected absent-body mutation. None grants authority.
export function requestModelOutputs(document:OpenApiDocument,requests:readonly RequestModel[]):Record<string,string>{
  if(!document.openapi.startsWith('3.1.'))throw new Error('REQUEST_MODELS_REQUIRE_OPENAPI_3_1');
  const ajv=new Ajv({strict:true,allErrors:false,code:{source:true},coerceTypes:false,useDefaults:false,removeAdditional:false});
  addFormats(ajv);
  const mapping:Record<string,string>={},types:string[]=[],validators:string[]=[],bodyless:string[]=[],optional:string[]=[];
  for(const request of requests){
    validators.push('  readonly '+JSON.stringify(request.name)+': (value: unknown) => boolean;');
    if(request.body==='none'){
      types.push('  '+JSON.stringify(request.name)+': undefined;');
      bodyless.push('exports['+JSON.stringify(request.name)+'] = value => value === undefined;');
      continue;
    }
    const id='urn:mpfrontend:request:'+request.name;
    if(request.body==='optional-json'){
      const {schema,nonNull}=optionalJsonBranches(request.schema,document);
      const type=(nonNull?readType(nonNull,document,0,'request')+' | null':readType(schema,document,0,'request'))+' | undefined';
      const shape=nonNull?{...schema,oneOf:[{type:'null'},readShape(nonNull,document,0,'request')]}:readShape(schema,document,0,'request');
      types.push('  '+JSON.stringify(request.name)+': '+type+';');
      ajv.addSchema({...shape,$id:id});mapping[request.name]=id;optional.push(request.name);continue;
    }
    types.push('  '+JSON.stringify(request.name)+': '+readType(request.schema,document,0,'request')+';');
    ajv.addSchema({...readShape(request.schema,document,0,'request'),$id:id});mapping[request.name]=id;
  }
  return {
    'request-models.gen.ts':requests.length?'import validators from "./request-validators.gen.cjs";\nexport type RequestModels = {\n'+types.join('\n')+'\n};\n'+
      'export function parseRequest<K extends keyof RequestModels>(request: K, value: unknown): RequestModels[K] {\n'+
      '  if (!Object.hasOwn(validators, request) || !validators[request](value)) throw new Error("INVALID_API_REQUEST");\n'+
      '  return value as RequestModels[K];\n}\n':
      'export type RequestModels = Record<never, never>;\nexport function parseRequest(request: never, value: unknown): never {\n  void request; void value; throw new Error("INVALID_API_REQUEST");\n}\n',
    'request-validators.gen.cjs':standalone(ajv,mapping)+(bodyless.length?'\n'+bodyless.join('\n')+'\n':'')+
      (optional.length?'\n'+optional.map((name,index)=>'const optional'+index+'=exports['+JSON.stringify(name)+']; exports['+JSON.stringify(name)+'] = value => value === undefined || optional'+index+'(value);').join('\n')+'\n':''),
    'request-validators.gen.d.cts':validators.length?'declare const validators: {\n'+validators.join('\n')+'\n};\nexport = validators;\n':'declare const validators: Record<string, never>;\nexport = validators;\n'
  };
}
