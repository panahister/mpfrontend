export type JsonSchema = {
  type?: string | readonly string[]; $ref?: string; properties?: Record<string, JsonSchema>;
  items?: JsonSchema; required?: readonly string[]; enum?: readonly unknown[]; format?: string;
  readOnly?: boolean; writeOnly?: boolean; additionalProperties?: boolean | JsonSchema;
  nullable?: boolean; allOf?: readonly JsonSchema[]; oneOf?: readonly JsonSchema[]; anyOf?: readonly JsonSchema[];
  title?:string;description?:string;default?:unknown;examples?:readonly unknown[];
  minLength?:number;maxLength?:number;pattern?:string;
  minimum?:number;maximum?:number;exclusiveMinimum?:number;exclusiveMaximum?:number;multipleOf?:number;
  minItems?:number;maxItems?:number;uniqueItems?:boolean;
  minProperties?:number;maxProperties?:number;
};
export type FieldModel = Readonly<{ key: string; type: string; nullable: boolean; required: boolean; format?: string; values?: readonly unknown[]; editable: boolean }>;
export type ResourceModel = Readonly<{name:string;operationId:string;path:string;method:string;fields:readonly FieldModel[]}>&
  (Readonly<{body:'none';responseStatus:'204';schema?:never}>|Readonly<{body?:'json';responseStatus?:'200'|'201'|'202';schema:JsonSchema}>);
export type ResourceSelection = Readonly<{name:string;operationId:string}>&
  (Readonly<{body:'none';responseStatus:'204';responsePath?:never}>|Readonly<{body?:never;responsePath?:readonly string[];responseStatus?:'200'|'201'|'202'}>);
export type RequestSelection = Readonly<{name:string;operationId:string}>&
  (Readonly<{body:'none'|'optional-json'}>|Readonly<{body?:never}>);
export type RequestModel = Readonly<{name:string;operationId:string;path:string;method:string;fields:readonly FieldModel[]}>&
  (Readonly<{body:'none';schema?:never}>|Readonly<{body:'optional-json';schema:JsonSchema}>|Readonly<{body?:'json';schema:JsonSchema}>);
export type OpenApiDocument = { openapi: string; paths: Record<string, Record<string, unknown>>; components?: { schemas?: Record<string, JsonSchema> } };
export function resolveSchema(schema: JsonSchema, document: OpenApiDocument, seen: readonly string[] = []): JsonSchema {
  if (!schema.$ref) return schema;
  const prefix = '#/components/schemas/';
  if (!schema.$ref.startsWith(prefix) || seen.includes(schema.$ref)) throw new Error('UNSUPPORTED_SCHEMA_REFERENCE');
  const name = schema.$ref.slice(prefix.length).replace(/~1/g, '/').replace(/~0/g, '~');
  const value = document.components?.schemas?.[name];
  if (!value) throw new Error('MISSING_SCHEMA_REFERENCE');
  if(Object.keys(schema).some(key=>!['$ref','title','description','readOnly','writeOnly'].includes(key)))throw new Error('UNSUPPORTED_SCHEMA_REFERENCE_SIBLINGS');
  return {...resolveSchema(value, document, [...seen, schema.$ref]),
    ...(schema.readOnly!==undefined?{readOnly:schema.readOnly}:{}),...(schema.writeOnly!==undefined?{writeOnly:schema.writeOnly}:{})};
}
export function fieldsFor(schema: JsonSchema, document: OpenApiDocument,direction:'read'|'request'='read'): readonly FieldModel[] {
  const resolved = resolveSchema(schema, document);
  if (resolved.type !== 'object' || !resolved.properties || resolved.allOf || resolved.oneOf || resolved.anyOf) throw new Error('UNSUPPORTED_OBJECT_SCHEMA');
  return Object.entries(resolved.properties).sort(([a], [b]) => a.localeCompare(b, 'en')).filter(([,raw]) => {
    const s=resolveSchema(raw,document);return direction==='read'?!s.writeOnly:!s.readOnly;
  }).map(([key,raw]) => {
    const s = resolveSchema(raw, document);
    if (s.oneOf || s.anyOf || s.allOf) throw new Error('UNSUPPORTED_FIELD_UNION');
    const types = Array.isArray(s.type) ? s.type : [s.type];
    const effective = types.filter(t => t !== 'null');
    if (effective.length !== 1 || !['string','number','integer','boolean','array','object'].includes(effective[0] ?? '')) throw new Error('UNSUPPORTED_FIELD_TYPE');
    return { key, type: effective[0]!, required: resolved.required?.includes(key) ?? false,
      nullable: types.includes('null') || s.nullable === true, editable: direction==='request',
      ...(s.format ? { format: s.format } : {}), ...(s.enum ? { values: s.enum } : {}) };
  });
}
function optionalJsonObject(schema:JsonSchema,document:OpenApiDocument):JsonSchema{
  const resolved=resolveSchema(schema,document);
  if(!resolved.oneOf){
    if(Array.isArray(resolved.type)){
      const effective=resolved.type.filter(type=>type!=='null');
      if(!resolved.type.includes('null')||effective.length!==1||effective[0]!=='object')throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
      return {...resolved,type:'object'};
    }
    return resolved;
  }
  if(resolved.anyOf||resolved.allOf||resolved.oneOf.length!==2)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  const branches=resolved.oneOf.map(branch=>resolveSchema(branch,document));
  const nulls=branches.filter(branch=>branch.type==='null');
  if(nulls.length!==1)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  const object=branches.find(branch=>branch.type!=='null');
  if(!object||object.oneOf||object.anyOf||object.allOf)throw new Error('UNSUPPORTED_OPTIONAL_JSON_SCHEMA');
  return object;
}
export function normalizeRequests(document:OpenApiDocument,selections:readonly RequestSelection[]):readonly RequestModel[]{
  const operations=new Map<string,{path:string;method:string;op:Record<string,unknown>}>();
  for(const [path,item]of Object.entries(document.paths))for(const [method,value]of Object.entries(item)){
    if(!['get','post','put','patch','delete','head','options'].includes(method))continue;
    const op=value as Record<string,unknown>;
    if(typeof op.operationId!=='string'||operations.has(op.operationId))throw new Error('MISSING_OR_DUPLICATE_OPERATION_ID');
    operations.set(op.operationId,{path,method,op});
  }
  const names=new Set<string>();
  return selections.map(selection=>{
    if(!/^[a-z][a-z0-9-]*$/.test(selection.name)||names.has(selection.name))throw new Error('INVALID_REQUEST_NAME');
    names.add(selection.name);const operation=operations.get(selection.operationId);
    if(!operation)throw new Error('UNKNOWN_OPERATION_ID');
    if(!['post','put','patch','delete'].includes(operation.method))throw new Error('REQUEST_REQUIRES_MUTATION_OPERATION');
    if(selection.body!==undefined&&!['none','optional-json'].includes(selection.body))throw new Error('UNSUPPORTED_REQUEST_BODY_PROFILE');
    if(selection.body==='none'){
      // No requestBody in the contract is not a guessed empty object or an optional JSON payload.
      if(Object.hasOwn(operation.op,'requestBody'))throw new Error('BODY_PROFILE_MISMATCH');
      return {name:selection.name,operationId:selection.operationId,path:operation.path,method:operation.method,body:'none',fields:[]};
    }
    const body=operation.op.requestBody as {required?:boolean;content?:Record<string,{schema?:JsonSchema}>}|undefined;
    if(!body?.content?.['application/json']?.schema)throw new Error('MISSING_JSON_REQUEST');
    if(selection.body==='optional-json'){
      if(body.required===true)throw new Error('OPTIONAL_REQUEST_BODY_PROFILE_MISMATCH');
      const schema=resolveSchema(body.content['application/json'].schema,document);
      return {name:selection.name,operationId:selection.operationId,path:operation.path,method:operation.method,body:'optional-json',schema,fields:fieldsFor(optionalJsonObject(schema,document),document,'request')};
    }
    if(body.required!==true)throw new Error('OPTIONAL_REQUEST_BODY_NOT_SUPPORTED');
    const schema=resolveSchema(body.content['application/json'].schema,document);
    return {name:selection.name,operationId:selection.operationId,path:operation.path,method:operation.method,schema,fields:fieldsFor(schema,document,'request')};
  });
}
export function normalizeResources(document: OpenApiDocument, selections: readonly ResourceSelection[]): readonly ResourceModel[] {
  const operations = new Map<string, {path:string;method:string;op:Record<string,unknown>}>();
  for (const [path, pathItem] of Object.entries(document.paths)) for (const [method, value] of Object.entries(pathItem)) {
    if (!['get','post','put','patch','delete','head','options'].includes(method)) continue;
    const op = value as Record<string,unknown>;
    if (typeof op.operationId !== 'string' || operations.has(op.operationId)) throw new Error('MISSING_OR_DUPLICATE_OPERATION_ID');
    operations.set(op.operationId, {path,method,op});
  }
  const names = new Set<string>();
  return selections.map(selection => {
    if (!/^[a-z][a-z0-9-]*$/.test(selection.name) || names.has(selection.name)) throw new Error('INVALID_RESOURCE_NAME');
    names.add(selection.name);
    const operation = operations.get(selection.operationId);
    if (!operation) throw new Error('UNKNOWN_OPERATION_ID');
    const responses = operation.op.responses as Record<string, {content?: Record<string,{schema?:JsonSchema}>}>|undefined;
    const responseStatus=selection.responseStatus??'200';
    if((selection as {body?:unknown}).body!==undefined&&(selection as {body?:unknown}).body!=='none')throw new Error('UNSUPPORTED_RESPONSE_BODY_PROFILE');
    if((selection as {body?:unknown}).body==='none'){
      if(responseStatus!=='204')throw new Error('EMPTY_RESPONSE_REQUIRES_204');
      if((selection as {responsePath?:readonly string[]}).responsePath?.length)throw new Error('EMPTY_RESPONSE_PATH_NOT_SUPPORTED');
      const response=responses?.['204'];
      if(!response)throw new Error('MISSING_EMPTY_RESPONSE');
      if(Object.hasOwn(response,'content'))throw new Error('RESPONSE_BODY_PROFILE_MISMATCH');
      return {name:selection.name,operationId:selection.operationId,path:operation.path,method:operation.method,responseStatus:'204',body:'none',fields:[]};
    }
    if(responseStatus==='204')throw new Error('RESPONSE_BODY_PROFILE_MISMATCH');
    if(!['200','201','202'].includes(responseStatus))throw new Error('UNSUPPORTED_JSON_SUCCESS_STATUS');
    let schema = responses?.[responseStatus]?.content?.['application/json']?.schema;
    if (!schema) throw new Error('MISSING_JSON_RESPONSE');
    for (const key of selection.responsePath ?? []) {
      schema = resolveSchema(schema, document).properties?.[key];
      if (!schema) throw new Error('INVALID_RESPONSE_PATH');
    }
    schema = resolveSchema(schema, document);
    if (schema.type === 'array') {
      if (!schema.items) throw new Error('MISSING_ARRAY_ITEMS');
      schema = resolveSchema(schema.items, document);
    }
    return { name: selection.name, operationId: selection.operationId, path: operation.path, method: operation.method,responseStatus, schema, fields: fieldsFor(schema, document) };
  });
}
export function validateRead(value: unknown, schema: JsonSchema, document: OpenApiDocument, depth = 0): boolean {
  if (depth > 32) return false;
  const s = resolveSchema(schema, document);
  if (value === null) return s.nullable === true || (Array.isArray(s.type) && s.type.includes('null'));
  const type = Array.isArray(s.type) ? s.type.find(t => t !== 'null') : s.type;
  if (s.enum && !s.enum.some(v => Object.is(v,value))) return false;
  if (type === 'string') return typeof value === 'string';
  if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value));
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value) && !!s.items && value.every(v => validateRead(v,s.items!,document,depth+1));
  if (type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const data = value as Record<string,unknown>;
    if (s.required?.some(key => !(key in data))) return false;
    if (s.additionalProperties === false && Object.keys(data).some(key => !s.properties?.[key])) return false;
    return Object.entries(s.properties ?? {}).every(([key, child]) => !(key in data) || validateRead(data[key],child,document,depth+1));
  }
  return false;
}
