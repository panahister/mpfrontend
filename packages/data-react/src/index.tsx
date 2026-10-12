'use client';
import {useEffect,type ReactNode} from 'react';
import {useMutation,useQuery,useQueryClient,type UseMutationResult,type UseQueryResult} from '@tanstack/react-query';
import {useQueryStates} from 'nuqs';
import {useAccessCapture,useAccessScope} from '@mpfrontend/access-react';
import type {ListSort,ListState} from '@mpfrontend/ftg-core';
import {inScope,scopedQueryKey,type ListUrlState,type ViewCheck} from './shared.js';

// The functions of the URL state and the query keys are in the shared entry, `@mpfrontend/data-react/shared`, which
// server code imports too.
export type {QueryScope as QueryKeyScope,ListUrlOptions,ListUrlState,ViewCheck} from './shared.js';

/**
 * Keeps the app's query cache to the access scope in use. When the context reference or revision changes, every query
 * of another scope, and every query without a scope, is cancelled and removed, so its data never shows again. Place
 * it inside the app's QueryClientProvider and the AccessProvider.
 */
export function QueryScope({children}:Readonly<{children?:ReactNode}>){
  const client=useQueryClient(),scope=useAccessScope();
  const key=scope?scope.contextRef+'\n'+scope.revision:'';
  useEffect(()=>{
    const stale={predicate:(query:{queryKey:readonly unknown[]})=>!inScope(query.queryKey,scope)};
    void client.cancelQueries(stale);client.removeQueries(stale);
    // The scope object changes with its key only.
  },[client,key]);
  return children??null;
}

type JsonParams=string|number|boolean|null|readonly JsonParams[]|{readonly [key:string]:JsonParams|undefined};
export type ScopedQueryOptions<Params extends JsonParams,Data>=Readonly<{
  /** A stable name of the read, the same for every parameter value. */
  operation:string;
  params:Params;
  /** Reads through the app's own route or the BFF, never a backend directly, and passes the signal on. */
  read:(params:Params,signal:AbortSignal)=>Promise<Data>;
  initialData?:Data;
  enabled?:boolean;
  staleTime?:number;
}>;
/**
 * A server read under the current access scope: its key is the scope, the operation and the parameters. Without a
 * valid snapshot it does not run. A change of scope aborts it, and its late answer is dropped.
 */
export function useScopedQuery<Params extends JsonParams,Data>(options:ScopedQueryOptions<Params,Data>):UseQueryResult<Data>{
  const scope=useAccessScope(),capture=useAccessCapture();
  return useQuery<Data>({
    queryKey:scope?scopedQueryKey(scope,options.operation,options.params):['mpfrontend-closed',options.operation],
    enabled:scope!==undefined&&(options.enabled??true),
    queryFn:async({signal})=>{
      const work=capture();
      const data=await options.read(options.params,AbortSignal.any([signal,work.signal]));
      work.assertCurrent();
      return data;
    },
    ...(options.initialData!==undefined?{initialData:options.initialData}:{}),
    ...(options.staleTime!==undefined?{staleTime:options.staleTime}:{}),
  });
}

export type ScopedMutationOptions<Variables,Result>=Readonly<{
  operation:string;
  /** Writes through the app's own route or the BFF and passes the signal on. */
  write:(variables:Variables,signal:AbortSignal)=>Promise<Result>;
  /** The reads whose data the write changes; they are invalidated in the current scope after it succeeds. */
  invalidates:readonly string[];
}>;
/**
 * A write under the current access scope. It is never retried automatically, after a refusal or any other failure.
 * A change of scope aborts it and its result is not published.
 */
export function useScopedMutation<Variables,Result>(options:ScopedMutationOptions<Variables,Result>):UseMutationResult<Result,Error,Variables>{
  const client=useQueryClient(),scope=useAccessScope(),capture=useAccessCapture();
  return useMutation<Result,Error,Variables>({
    mutationKey:['mpfrontend-write',options.operation],
    retry:false,
    mutationFn:async variables=>{
      const work=capture();
      const result=await options.write(variables,work.signal);
      work.assertCurrent();
      return result;
    },
    onSuccess:async()=>{
      if(!scope)return;
      await Promise.all(options.invalidates.map(operation=>client.invalidateQueries({queryKey:[...scopedQueryKey(scope,operation)]})));
    },
  });
}

export type ListStateChange=Readonly<{page?:number;size?:number;sort?:ListSort|undefined;filters?:Readonly<Record<string,string>>}>;
/**
 * The list state of the URL. Each change is a new history entry, so back and forward move through pages and filters;
 * a new size, sort or filter starts again at the first page. A sort or a filter on a field the person may not view is
 * dropped, and removed from the URL on load.
 */
export function useListUrlState(urlState:ListUrlState,options:Readonly<{canView?:ViewCheck}>={}):readonly [ListState,(change:ListStateChange)=>void]{
  const [values,setValues]=useQueryStates(urlState.parsers,{history:'push'});
  const state=urlState.fromValues(values as Record<string,unknown>,options);
  const hidden=urlState.hidden(values as Record<string,unknown>,options.canView).join(',');
  useEffect(()=>{
    if(hidden)void setValues(Object.fromEntries(hidden.split(',').map(key=>[key,null])) as never,{history:'replace'});
  },[hidden,setValues]);
  const change=(next:ListStateChange)=>{
    const update:Record<string,unknown>={};
    if(next.size!==undefined)update.size=next.size;
    if('sort' in next)update.sort=next.sort??null;
    for(const [name,value] of Object.entries(next.filters??{}))update[name]=value===''?null:value;
    update.page=next.page!==undefined?next.page:null;
    void setValues(update as never);
  };
  return [state,change] as const;
}

/** Field access for the URL state: a reader of the access snapshot. */
export type FieldView=Readonly<{field:(key:string)=>Readonly<{view:boolean}>}>;
/**
 * The controlled values and change events of a ResourceTable bound to the URL: page, size, sort and filters.
 * With `access`, a sort or a filter on a column the person may not view is dropped.
 */
export function useTableUrlState(urlState:ListUrlState,options:Readonly<{access?:FieldView}>={}){
  const access=options.access;
  const [state,change]=useListUrlState(urlState,access?{canView:key=>access.field(key).view}:{});
  return {
    page:state.page,size:state.size,sort:state.sort,filters:state.filters??{},
    onPageChange:(page:number)=>change({page}),
    onSizeChange:(size:number)=>change({size}),
    onSortChange:(sort:ListSort|undefined)=>change({sort}),
    onFiltersChange:(filters:Readonly<Record<string,string>>)=>change({filters}),
  };
}
