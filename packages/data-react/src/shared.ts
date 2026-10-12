import {createLoader,createParser,createSerializer,type LoaderInput,type ParserMap} from 'nuqs/server';
import type {ListProtocol,ListSort,ListState} from '@mpfrontend/ftg-core';

/** The context reference and revision of the access snapshot in use. It is part of every query key, never of a URL. */
export type QueryScope=Readonly<{contextRef:string;revision:string}>;
type Json=string|number|boolean|null|readonly Json[]|{readonly [key:string]:Json|undefined};

const SCOPED='mpfrontend-scoped';
/**
 * The key of a server read: the scope, the operation and its parameters. Data read under one context or revision is
 * kept under keys of that scope only, so it never shows under another. Without parameters it is the prefix that an
 * invalidation of the operation matches.
 */
export function scopedQueryKey(scope:QueryScope,operation:string,params?:Json):readonly unknown[]{
  return params===undefined?[SCOPED,scope.contextRef,scope.revision,operation]:[SCOPED,scope.contextRef,scope.revision,operation,params];
}
/** Whether a query key belongs to the scope; a key of no scope belongs to none. */
export function inScope(key:readonly unknown[],scope:QueryScope|undefined):boolean{
  return scope!==undefined&&key[0]===SCOPED&&key[1]===scope.contextRef&&key[2]===scope.revision;
}

export type ListUrlOptions=Readonly<{
  /** The page size when the URL names none. */
  size:number;
  /** The page sizes offered; without it any size from 1 to the protocol's maximum. */
  sizes?:readonly number[];
  /** The sort when the URL names none. */
  sort?:ListSort;
  /** The highest page number accepted from a URL. */
  maxPage?:number;
}>;
/** Which row fields the person may view; a sort or a filter on another field is dropped. */
export type ViewCheck=(field:string)=>boolean;
export type ListUrlState=Readonly<{
  protocol:ListProtocol;
  /** The parsers of the URL keys: `page`, `size`, `sort` and one per filter of the protocol. */
  parsers:ParserMap;
  defaults:ListState;
  /** The state of a URL, the same way on the server for the first render and in the browser. */
  read:(search:LoaderInput,options?:Readonly<{canView?:ViewCheck}>)=>ListState;
  /** The state of parsed values. */
  fromValues:(values:Readonly<Record<string,unknown>>,options?:Readonly<{canView?:ViewCheck}>)=>ListState;
  /** The URL keys of parsed values that name a field the person may not view. */
  hidden:(values:Readonly<Record<string,unknown>>,canView:ViewCheck|undefined)=>string[];
  /** The query string of a state, without the values that equal their defaults: '' or '?page=2'. */
  serialize:(state:ListState)=>string;
}>;

const RESERVED=new Set(['page','size','sort']);
/**
 * The URL state of a list over one protocol: typed keys with defaults and limits. Only the sort fields and filters
 * that the protocol declares are read; an invalid value falls back to its default. The scope never enters the URL.
 */
export function listUrlState(protocol:ListProtocol,options:ListUrlOptions):ListUrlState{
  const maxPage=options.maxPage??100000;
  const validSize=(size:number)=>Number.isInteger(size)&&size>=1&&size<=protocol.size.max&&(!options.sizes||options.sizes.includes(size));
  if(!validSize(options.size)||(options.sizes&&!options.sizes.every(validSize)))throw new Error('INVALID_LIST_DEFAULT');
  const sort=protocol.sort;
  if(options.sort&&(!sort||!sort.fields.includes(options.sort.field)))throw new Error('INVALID_LIST_DEFAULT');
  const filters=Object.entries(protocol.filters??{});
  for(const [name] of filters)if(RESERVED.has(name)||!/^[a-z][A-Za-z0-9_-]{0,39}$/.test(name))throw new Error('RESERVED_OR_INVALID_URL_KEY:'+name);
  const integer=(min:number,max:number)=>(value:string)=>/^\d{1,9}$/.test(value)&&Number(value)>=min&&Number(value)<=max?Number(value):null;
  const parsers:ParserMap={
    page:createParser({parse:integer(1,maxPage),serialize:String}).withDefault(1),
    size:createParser({parse:value=>{const size=integer(1,protocol.size.max)(value);return size!==null&&validSize(size)?size:null;},serialize:String}).withDefault(options.size),
  };
  if(sort){
    const parser=createParser<ListSort>({
      parse:value=>{
        const at=value.lastIndexOf('.'),field=value.slice(0,at),direction=value.slice(at+1);
        return at>0&&sort.fields.includes(field)&&(direction==='asc'||direction==='desc')?{field,direction}:null;
      },
      serialize:value=>value.field+'.'+value.direction,
      eq:(a,b)=>a.field===b.field&&a.direction===b.direction,
    });
    parsers.sort=options.sort?parser.withDefault(options.sort):parser;
  }
  for(const [name,filter] of filters)
    parsers[name]=createParser({parse:value=>value.length<=filter.maxLength?value:null,serialize:value=>value}).withDefault('');
  const hidden=(values:Readonly<Record<string,unknown>>,canView:ViewCheck|undefined)=>{
    if(!canView)return [];
    const keys:string[]=[];
    const current=values.sort as ListSort|null|undefined;
    if(current&&!canView(current.field))keys.push('sort');
    for(const [name,filter] of filters)if(filter.field!==undefined&&values[name]&&!canView(filter.field))keys.push(name);
    return keys;
  };
  const fromValues=(values:Readonly<Record<string,unknown>>,read:Readonly<{canView?:ViewCheck}>={})=>{
    const dropped=new Set(hidden(values,read.canView));
    const current=values.sort as ListSort|null|undefined;
    return Object.freeze({page:values.page as number,size:values.size as number,
      sort:current&&!dropped.has('sort')?current:undefined,
      filters:Object.freeze(Object.fromEntries(filters.map(([name])=>[name,dropped.has(name)?'':String(values[name]??'')])))});
  };
  const loader=createLoader(parsers),serializer=createSerializer(parsers);
  const defaults=fromValues(loader(''));
  return Object.freeze({protocol,parsers,defaults,hidden,fromValues,
    read:(search:LoaderInput,read:Readonly<{canView?:ViewCheck}>={})=>fromValues(loader(search),read),
    serialize:(state:ListState)=>serializer({page:state.page,size:state.size,...(sort?{sort:state.sort??null}:{}),
      ...Object.fromEntries(filters.map(([name])=>[name,state.filters?.[name]||null]))} as never)});
}
