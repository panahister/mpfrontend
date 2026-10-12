import {resolveSchema,type JsonSchema,type OpenApiDocument} from './model.js';

/**
 * How one backend list operation encodes paging, sorting and filtering, and where its answer holds the rows and the
 * total. It is data that a consumer declares for an operation, and checkListProtocol checks it against the
 * operation of the captured contract, so that a request sends only parameters the operation declares.
 */
export type ListProtocol=Readonly<{
  operationId:string;
  /** A page number counted from `first`, or an offset of rows. */
  page:Readonly<{param:string;encoding:'number';first:0|1}>|Readonly<{param:string;encoding:'offset'}>;
  size:Readonly<{param:string;max:number}>;
  /** `field,direction` (name,asc), `signed` (name or -name), or `separate` (a field and a direction parameter). */
  sort?:Readonly<{param:string;fields:readonly string[];encoding:'field,direction'|'signed'}>
    |Readonly<{param:string;fields:readonly string[];encoding:'separate';directionParam:string}>;
  /** Filters by name: the parameter each one is sent as, its length limit and the row field it filters, if any. */
  filters?:Readonly<Record<string,Readonly<{param:string;maxLength:number;field?:string}>>>;
  /** The path of the rows array in the answer, and of the total number of rows when the backend reports one. */
  rows:readonly string[];
  total?:readonly string[];
}>;
export type ListSort=Readonly<{field:string;direction:'asc'|'desc'}>;
/** One request of a list: the page counted from 1, the page size, the sort and the filter values. */
export type ListState=Readonly<{page:number;size:number;sort?:ListSort|undefined;filters?:Readonly<Record<string,string>>}>;

type Parameter={name?:unknown;in?:unknown;required?:unknown;schema?:JsonSchema;$ref?:unknown};
const METHODS=['get','post','put','patch','delete','head','options'];

function operation(document:OpenApiDocument,operationId:string){
  for(const pathItem of Object.values(document.paths))for(const [method,value] of Object.entries(pathItem)){
    if(METHODS.includes(method)&&(value as {operationId?:unknown}).operationId===operationId)
      return {pathItem:pathItem as {parameters?:Parameter[]},op:value as {parameters?:Parameter[];responses?:Record<string,{content?:Record<string,{schema?:JsonSchema}>}>}};
  }
  return undefined;
}
function parameter(document:OpenApiDocument,value:Parameter):Parameter{
  if(typeof value.$ref!=='string')return value;
  const prefix='#/components/parameters/';
  const parameters=(document.components as {parameters?:Record<string,Parameter>}|undefined)?.parameters;
  const target=value.$ref.startsWith(prefix)?parameters?.[value.$ref.slice(prefix.length)]:undefined;
  if(!target||typeof target.$ref==='string')throw new Error('UNSUPPORTED_PARAMETER_REFERENCE');
  return target;
}
function typeOf(schema:JsonSchema|undefined,document:OpenApiDocument):string|undefined{
  if(!schema)return undefined;
  const resolved=resolveSchema(schema,document);
  const types=Array.isArray(resolved.type)?resolved.type.filter(type=>type!=='null'):[resolved.type];
  return types.length===1?types[0]:undefined;
}
function at(schema:JsonSchema,path:readonly string[],document:OpenApiDocument):JsonSchema|undefined{
  let current:JsonSchema|undefined=schema;
  for(const key of path)current=current?resolveSchema(current,document).properties?.[key]:undefined;
  return current?resolveSchema(current,document):undefined;
}
function sortValues(protocol:ListProtocol):string[]{
  const sort=protocol.sort;
  if(!sort)return [];
  return sort.fields.flatMap(field=>sort.encoding==='field,direction'?[field+',asc',field+',desc']:sort.encoding==='signed'?[field,'-'+field]:[field]);
}

/**
 * The problems of a protocol against the operation of the captured contract: an unknown operation, a parameter the
 * operation does not declare in its query, a type or limit the operation does not accept, a required query parameter
 * the protocol does not send, and rows or a total that the answer does not hold where the protocol says.
 */
export function checkListProtocol(document:OpenApiDocument,protocol:ListProtocol):string[]{
  const found=operation(document,protocol.operationId);
  if(!found)return ['UNKNOWN_OPERATION:'+protocol.operationId];
  const problems:string[]=[];
  const query=new Map<string,Parameter>();
  for(const raw of [...(found.pathItem.parameters??[]),...(found.op.parameters??[])]){
    const value=parameter(document,raw);
    if(value.in==='query'&&typeof value.name==='string')query.set(value.name,value);
  }
  const sent=new Map<string,'integer'|'string'>([[protocol.page.param,'integer'],[protocol.size.param,'integer']]);
  if(protocol.sort){
    sent.set(protocol.sort.param,'string');
    if(protocol.sort.encoding==='separate')sent.set(protocol.sort.directionParam,'string');
  }
  for(const filter of Object.values(protocol.filters??{}))sent.set(filter.param,'string');
  const count=[protocol.page.param,protocol.size.param,...(protocol.sort?[protocol.sort.param]:[]),
    ...(protocol.sort?.encoding==='separate'?[protocol.sort.directionParam]:[]),...Object.values(protocol.filters??{}).map(filter=>filter.param)];
  for(const name of new Set(count.filter((name,index)=>count.indexOf(name)!==index)))problems.push('DUPLICATE_PARAMETER:'+name);
  for(const [name,type] of sent){
    const declared=query.get(name);
    if(!declared){problems.push('UNDECLARED_PARAMETER:'+name);continue;}
    if(typeOf(declared.schema,document)!==type)problems.push('PARAMETER_TYPE:'+name);
  }
  for(const [name,declared] of query)if(declared.required===true&&!sent.has(name))problems.push('REQUIRED_PARAMETER_NOT_SENT:'+name);
  const schemaOf=(name:string)=>{const declared=query.get(name);return declared?.schema?resolveSchema(declared.schema,document):undefined;};
  const size=schemaOf(protocol.size.param);
  if(!Number.isInteger(protocol.size.max)||protocol.size.max<1||(size?.maximum!==undefined&&protocol.size.max>size.maximum))problems.push('SIZE_ABOVE_MAXIMUM');
  const page=schemaOf(protocol.page.param),lowest=protocol.page.encoding==='number'?protocol.page.first:0;
  if(page?.minimum!==undefined&&lowest<page.minimum)problems.push('PAGE_BELOW_MINIMUM');
  const sortSchema=protocol.sort?schemaOf(protocol.sort.param):undefined;
  if(sortSchema?.enum)for(const value of sortValues(protocol))if(!sortSchema.enum.includes(value))problems.push('SORT_VALUE_NOT_ALLOWED:'+value);
  if(protocol.sort?.encoding==='separate'){
    const direction=schemaOf(protocol.sort.directionParam);
    if(direction?.enum&&!['asc','desc'].every(value=>direction.enum!.includes(value)))problems.push('SORT_DIRECTION_NOT_ALLOWED');
  }
  for(const [name,filter] of Object.entries(protocol.filters??{})){
    const schema=schemaOf(filter.param);
    if(!Number.isInteger(filter.maxLength)||filter.maxLength<1||(schema?.maxLength!==undefined&&filter.maxLength>schema.maxLength))problems.push('FILTER_ABOVE_MAXIMUM:'+name);
  }
  const answer=found.op.responses?.['200']?.content?.['application/json']?.schema;
  if(!answer)return [...problems,'MISSING_JSON_RESPONSE'];
  const rows=at(answer,protocol.rows,document);
  if(!rows||typeOf(rows,document)!=='array'||!rows.items)problems.push('ROWS_NOT_ARRAY');
  else{
    const item=resolveSchema(rows.items,document);
    for(const field of protocol.sort?.fields??[])if(!item.properties?.[field])problems.push('SORT_FIELD_NOT_IN_ROWS:'+field);
    for(const [name,filter] of Object.entries(protocol.filters??{}))if(filter.field!==undefined&&!item.properties?.[filter.field])problems.push('FILTER_FIELD_NOT_IN_ROWS:'+name);
  }
  if(protocol.total&&typeOf(at(answer,protocol.total,document),document)!=='integer')problems.push('TOTAL_NOT_INTEGER');
  return problems;
}

/** Whether a state fits the protocol: a page from 1, a size up to the maximum, a declared sort and declared filters. */
export function validListState(protocol:ListProtocol,state:ListState):boolean{
  if(!Number.isSafeInteger(state.page)||state.page<1||!Number.isInteger(state.size)||state.size<1||state.size>protocol.size.max)return false;
  if(state.sort&&(!protocol.sort||!protocol.sort.fields.includes(state.sort.field)||!['asc','desc'].includes(state.sort.direction)))return false;
  return Object.entries(state.filters??{}).every(([name,value])=>{
    const filter=protocol.filters?.[name];
    return filter!==undefined&&typeof value==='string'&&value.length<=filter.maxLength;
  });
}

/** The query of one request: only the parameters the protocol declares, encoded its way. Throws INVALID_LIST_STATE. */
export function listSearchParams(protocol:ListProtocol,state:ListState):URLSearchParams{
  if(!validListState(protocol,state))throw new Error('INVALID_LIST_STATE');
  const params=new URLSearchParams();
  params.set(protocol.page.param,String(protocol.page.encoding==='number'?state.page-1+protocol.page.first:(state.page-1)*state.size));
  params.set(protocol.size.param,String(state.size));
  const sort=protocol.sort;
  if(sort&&state.sort){
    const {field,direction}=state.sort;
    if(sort.encoding==='separate'){params.set(sort.param,field);params.set(sort.directionParam,direction);}
    else if(sort.encoding==='signed')params.set(sort.param,direction==='desc'?'-'+field:field);
    else params.set(sort.param,field+','+direction);
  }
  for(const [name,value] of Object.entries(state.filters??{}))if(value!=='')params.set(protocol.filters![name]!.param,value);
  return params;
}

/** The rows and the total of an answer, where the protocol says they are. Throws INVALID_LIST_RESPONSE. */
export function listPage(protocol:ListProtocol,body:unknown):Readonly<{rows:readonly unknown[];total:number|undefined}>{
  const read=(path:readonly string[])=>path.reduce<unknown>((value,key)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.hasOwn(value,key)?(value as Record<string,unknown>)[key]:undefined,body);
  const rows=read(protocol.rows);
  if(!Array.isArray(rows))throw new Error('INVALID_LIST_RESPONSE');
  if(!protocol.total)return {rows,total:undefined};
  const total=read(protocol.total);
  if(!Number.isSafeInteger(total)||(total as number)<0)throw new Error('INVALID_LIST_RESPONSE');
  return {rows,total:total as number};
}
