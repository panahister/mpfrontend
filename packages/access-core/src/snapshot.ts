import {can,dirtyPatch,fieldAccess,type FieldAccess,type PageAccess} from './page-access.js';

/** The capability and field keys a consumer knows; a snapshot that names another key is refused. */
export type AccessKeys=Readonly<{capabilities:readonly string[];fields:readonly string[]}>;
/** What a snapshot must match to be used: the current time, the context the request is in, the known keys. */
export type AccessExpectation=Readonly<{now?:number;contextRef?:string;keys?:AccessKeys}>;
/** Why a snapshot was refused. A refused snapshot is never used: every entry stays closed. */
export type AccessRefusal='MALFORMED'|'EXPIRED'|'CONTEXT_MISMATCH'|'UNKNOWN_KEY';
export type AccessCheck=Readonly<{ok:true;access:PageAccess}>|Readonly<{ok:false;reason:AccessRefusal}>;
/** How a field is presented: not rendered, rendered and not editable, or editable. */
export type FieldPresentation='hidden'|'disabled'|'enabled';
/** A state the control already has; either one keeps it disabled whatever the snapshot grants. */
export type ControlState=Readonly<{disabled?:boolean;busy?:boolean}>;

const SNAPSHOT_KEYS=['capabilities','contextRef','expiresAt','fields','revision'];
const REFERENCE=/^[A-Za-z0-9._:~-]{1,128}$/;
const KEY=/^[A-Za-z0-9_.:/~-]{1,200}$/;
// Records are plain objects, so that a server component can pass a snapshot to a client component; a key that
// would name the prototype is refused.
const key=(value:string)=>KEY.test(value)&&value!=='__proto__';
const MAX_KEYS=4096;

function plainObject(value:unknown):value is Record<string,unknown>{
  if(typeof value!=='object'||value===null||Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return prototype===Object.prototype||prototype===null;
}
function exactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{
  const own=Object.keys(value).sort();
  return own.length===keys.length&&own.every((key,index)=>key===keys[index]);
}

/**
 * Validates an access snapshot at run time before anything reads it: its shape (exactly the five members, no
 * identity or token data beside them), its context reference and revision, its expiry, the context the caller
 * expects and, when given, the known keys. The result is a frozen copy; a refused snapshot grants nothing.
 */
export function parsePageAccess(value:unknown,expected:AccessExpectation={}):AccessCheck{
  const refuse=(reason:AccessRefusal):AccessCheck=>({ok:false,reason});
  if(!plainObject(value)||!exactKeys(value,SNAPSHOT_KEYS))return refuse('MALFORMED');
  const {contextRef,revision,expiresAt,capabilities,fields}=value;
  if(typeof contextRef!=='string'||!REFERENCE.test(contextRef))return refuse('MALFORMED');
  if(typeof revision!=='string'||!REFERENCE.test(revision))return refuse('MALFORMED');
  if(typeof expiresAt!=='number'||!Number.isFinite(expiresAt))return refuse('MALFORMED');
  if(!plainObject(capabilities)||!plainObject(fields))return refuse('MALFORMED');
  const capabilityEntries=Object.entries(capabilities),fieldEntries=Object.entries(fields);
  if(capabilityEntries.length>MAX_KEYS||fieldEntries.length>MAX_KEYS)return refuse('MALFORMED');
  const grants:Array<[string,boolean]>=[];
  for(const [name,granted] of capabilityEntries){
    if(!key(name)||typeof granted!=='boolean')return refuse('MALFORMED');
    grants.push([name,granted]);
  }
  const access:Array<[string,FieldAccess]>=[];
  for(const [name,field] of fieldEntries){
    if(!key(name)||!plainObject(field)||!exactKeys(field,['edit','view'])||typeof field.view!=='boolean'||typeof field.edit!=='boolean')
      return refuse('MALFORMED');
    access.push([name,Object.freeze({view:field.view,edit:field.edit})]);
  }
  if(expiresAt<=(expected.now??Date.now()))return refuse('EXPIRED');
  if(expected.contextRef!==undefined&&expected.contextRef!==contextRef)return refuse('CONTEXT_MISMATCH');
  if(expected.keys){
    const knownCapabilities=new Set(expected.keys.capabilities),knownFields=new Set(expected.keys.fields);
    if(capabilityEntries.some(([key])=>!knownCapabilities.has(key))||fieldEntries.some(([key])=>!knownFields.has(key)))return refuse('UNKNOWN_KEY');
  }
  return {ok:true,access:Object.freeze({contextRef,revision,expiresAt,
    capabilities:Object.freeze(Object.fromEntries(grants)),fields:Object.freeze(Object.fromEntries(access))})};
}

/** The part of a snapshot that some components need: only the listed keys, never more than the snapshot grants. */
export function pickPageAccess(access:PageAccess,keys:AccessKeys):PageAccess{
  const capabilities:Array<[string,boolean]>=[],fields:Array<[string,FieldAccess]>=[];
  for(const name of new Set(keys.capabilities))if(Object.hasOwn(access.capabilities,name))capabilities.push([name,access.capabilities[name]===true]);
  for(const name of new Set(keys.fields)){
    const field=Object.hasOwn(access.fields,name)?access.fields[name]:undefined;
    if(field)fields.push([name,Object.freeze({view:field.view===true,edit:field.edit===true})]);
  }
  return Object.freeze({contextRef:access.contextRef,revision:access.revision,expiresAt:access.expiresAt,
    capabilities:Object.freeze(Object.fromEntries(capabilities)),fields:Object.freeze(Object.fromEntries(fields))});
}

/** Hidden when the field may not be viewed, disabled when it may not be edited or the control is disabled or busy. */
export function fieldState(access:PageAccess|undefined,key:string,state:ControlState={},now=Date.now()):FieldPresentation{
  const field=fieldAccess(access,key,now);
  if(!field.view)return 'hidden';
  return field.edit&&!state.disabled&&!state.busy?'enabled':'disabled';
}

/** One snapshot read for components. Without a snapshot every entry is closed. Each read uses the current time. */
export type AccessReader=Readonly<{
  snapshot:PageAccess|undefined;
  can:(capability:string)=>boolean;
  field:(key:string)=>FieldAccess;
  fieldState:(key:string,state?:ControlState)=>FieldPresentation;
  /** The changed fields that may be edited (dirtyPatch); a change to any other field throws FORBIDDEN_FIELD. */
  patch:(original:Readonly<Record<string,unknown>>,draft:Readonly<Record<string,unknown>>)=>Record<string,unknown>;
}>;
const CLOSED:PageAccess=Object.freeze({contextRef:'closed',revision:'closed',expiresAt:0,capabilities:Object.freeze({}),fields:Object.freeze({})});
export function accessReader(snapshot:PageAccess|undefined,now:()=>number=Date.now):AccessReader{
  return Object.freeze({
    snapshot,
    can:(capability:string)=>can(snapshot,capability,now()),
    field:(key:string)=>fieldAccess(snapshot,key,now()),
    fieldState:(key:string,state:ControlState={})=>fieldState(snapshot,key,state,now()),
    patch:(original:Readonly<Record<string,unknown>>,draft:Readonly<Record<string,unknown>>)=>dirtyPatch(original,draft,snapshot??CLOSED,now()),
  });
}
