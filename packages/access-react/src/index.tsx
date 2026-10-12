'use client';
import {createContext,createElement,useContext,useEffect,useMemo,useRef,useState,
  type ComponentPropsWithoutRef,type ElementType,type ReactNode} from 'react';
import {AuthorityFence,accessReader,buildNavigation,parsePageAccess,
  type AccessKeys,type AccessReader,type ControlState,type FieldPresentation,type NavigationEntry,type PageAccess,type PageManifest} from '@mpfrontend/access-core';

/** granted: a valid snapshot is in use. Every other status closes every entry. */
export type AccessStatus='granted'|'missing'|'invalid'|'expired';
/** The context reference and revision of the snapshot in use: the scope of data read under it. */
export type AccessScope=Readonly<{contextRef:string;revision:string}>;
export type AccessCapture=Readonly<{signal:AbortSignal;assertCurrent:()=>void}>;
type Current=Readonly<{status:AccessStatus;snapshot:PageAccess|undefined}>;
type Value=Readonly<{reader:AccessReader;status:AccessStatus;scope:AccessScope|undefined;capture:()=>AccessCapture;now:()=>number}>;

const refusedCapture=():AccessCapture=>{throw new DOMException('AUTHORITY_CHANGED','AbortError');};
const CLOSED:Value=Object.freeze({reader:accessReader(undefined),status:'missing',scope:undefined,capture:refusedCapture,now:Date.now});
const AccessContext=createContext<Value>(CLOSED);
// setTimeout holds at most 2^31-1 milliseconds; a longer lifetime re-arms the timer.
const MAX_DELAY=2147483647;

export type AccessProviderProps=Readonly<{
  /** The part of the snapshot this subtree needs, as the server sent it; it is validated before use. */
  snapshot:unknown;
  /** Asks the consumer's loader again, through its own route or the BFF. Called when the window regains focus. */
  reload?:(signal:AbortSignal)=>Promise<unknown>;
  /** The keys this subtree knows; a snapshot that names another key is refused. */
  keys?:AccessKeys;
  /** The context this subtree is in; a snapshot of another context is refused. */
  contextRef?:string;
  now?:()=>number;
  children?:ReactNode;
}>;

/**
 * Holds one access snapshot for its subtree, readable during server rendering. A new snapshot replaces the old one
 * whole; at its expiry every entry closes, on an idle screen too; the loader is asked again when the window regains
 * focus. Work captured under one context and revision is aborted and cannot publish once they change. The snapshot
 * presents the server's decision; it never authorizes a request.
 */
export function AccessProvider({snapshot,reload,keys,contextRef,now=Date.now,children}:AccessProviderProps){
  const evaluate=(value:unknown):Current=>{
    if(value===undefined||value===null)return {status:'missing',snapshot:undefined};
    const result=parsePageAccess(value,{now:now(),...(keys?{keys}:{}),...(contextRef!==undefined?{contextRef}:{})});
    return result.ok?{status:'granted',snapshot:result.access}:{status:result.reason==='EXPIRED'?'expired':'invalid',snapshot:undefined};
  };
  const [held,setHeld]=useState(()=>({source:snapshot,current:evaluate(snapshot)}));
  let state=held;
  if(held.source!==snapshot){
    // A new snapshot from the server replaces the held one whole during this render.
    state={source:snapshot,current:evaluate(snapshot)};
    setHeld(state);
  }
  const {current}=state;
  const fence=useRef<AuthorityFence|null>(null);
  if(!fence.current)fence.current=new AuthorityFence();
  const identity=current.snapshot?current.snapshot.contextRef+'\n'+current.snapshot.revision:null;
  // Idempotent for an unchanged identity; a change aborts the work captured under the previous one before any
  // child reads the new scope.
  fence.current.update(identity);
  const latest=useRef(state);
  useEffect(()=>{latest.current=state;});

  const expiresAt=current.snapshot?.expiresAt;
  useEffect(()=>{
    if(expiresAt===undefined)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const check=()=>{
      const left=expiresAt-now();
      if(left>0){timer=setTimeout(check,Math.min(left,MAX_DELAY));return;}
      setHeld(previous=>previous.current.snapshot?.expiresAt===expiresAt&&previous.current.status==='granted'
        ?{source:previous.source,current:{status:'expired',snapshot:undefined}}:previous);
    };
    check();
    return ()=>clearTimeout(timer);
  },[expiresAt,now]);

  const reloadRef=useRef(reload);
  useEffect(()=>{reloadRef.current=reload;});
  const canReload=reload!==undefined;
  const evaluateRef=useRef(evaluate);
  useEffect(()=>{evaluateRef.current=evaluate;});
  useEffect(()=>{
    if(!canReload)return;
    let controller:AbortController|undefined;
    const run=()=>{
      controller?.abort();
      const own=controller=new AbortController(),startedWith=latest.current;
      Promise.resolve().then(()=>reloadRef.current?.(own.signal)).then(value=>{
        if(own.signal.aborted)return;
        // A snapshot that replaced this one while the request was pending wins; the late answer is dropped.
        setHeld(previous=>previous===startedWith?{source:previous.source,current:evaluateRef.current(value)}:previous);
      },()=>undefined);
    };
    const visible=()=>{if(document.visibilityState==='visible')run();};
    window.addEventListener('focus',run);document.addEventListener('visibilitychange',visible);
    return ()=>{controller?.abort();window.removeEventListener('focus',run);document.removeEventListener('visibilitychange',visible);};
  },[canReload]);

  const value=useMemo<Value>(()=>{
    const scope=current.snapshot?Object.freeze({contextRef:current.snapshot.contextRef,revision:current.snapshot.revision}):undefined;
    const owner=fence.current!;
    return Object.freeze({reader:accessReader(current.snapshot,now),status:current.status,scope,
      capture:identity===null?refusedCapture:()=>owner.capture(identity),now});
  },[current,identity,now]);
  return createElement(AccessContext.Provider,{value},children);
}

/** The snapshot reader of the nearest provider; without a provider every entry is closed. */
export function useAccess():AccessReader{return useContext(AccessContext).reader;}
export function useAccessStatus():AccessStatus{return useContext(AccessContext).status;}
/** The context reference and revision in use, or undefined when no valid snapshot is held. */
export function useAccessScope():AccessScope|undefined{return useContext(AccessContext).scope;}
/**
 * Captures the current context and revision for asynchronous work: abort with the signal and call assertCurrent
 * before publishing a result. It throws AUTHORITY_CHANGED when no valid snapshot is held.
 */
export function useAccessCapture():()=>AccessCapture{return useContext(AccessContext).capture;}
export function useCapability(capability:string):boolean{return useAccess().can(capability);}
/** hidden, disabled or enabled; a control that is already disabled or busy stays disabled. */
export function useFieldState(key:string,state:ControlState={}):FieldPresentation{return useAccess().fieldState(key,state);}
/** The navigation that the manifest and the snapshot allow. */
export function useNavigation(manifest:PageManifest):readonly NavigationEntry[]{
  const {reader,now}=useContext(AccessContext);
  return buildNavigation(manifest,reader.snapshot,now());
}

export type AccessGuardProps=
  | Readonly<{capability:string;children?:ReactNode;fallback?:ReactNode;whenDenied?:never}>
  | Readonly<{capability:string;whenDenied:'disabled';children:(state:Readonly<{disabled:boolean}>)=>ReactNode;fallback?:never}>;
/**
 * Renders its children only when the capability is granted, and otherwise nothing. A fallback, or children rendered
 * in a disabled state, only when this guard asks for it.
 */
export function AccessGuard(props:AccessGuardProps){
  const granted=useCapability(props.capability);
  if(props.whenDenied==='disabled')return props.children({disabled:!granted});
  return granted?props.children:(props.fallback??null);
}

export type AccessLinkProps<C extends ElementType>=Readonly<{capability:string;as?:C;fallback?:ReactNode}>
  &Omit<ComponentPropsWithoutRef<C>,'capability'|'as'|'fallback'>;
/**
 * A link that exists only when its capability is granted. When denied it renders no anchor, no href, no prefetch
 * and no focus target: nothing, or the fallback this link asks for. `as` renders the router's own link component.
 */
export function AccessLink<C extends ElementType='a'>({capability,as,fallback,...props}:AccessLinkProps<C>):ReactNode{
  const granted=useCapability(capability);
  if(!granted)return fallback??null;
  return createElement(as??'a',props);
}
