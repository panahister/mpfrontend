import {parsePageAccess,pickPageAccess,type AccessKeys,type AccessRefusal,type PageAccess} from '@mpfrontend/access-core';

// A bundler that does not read the "browser" export condition still reaches this module: where a document exists it
// refuses as well, so the loader never runs in a browser, whatever resolved the entry.
if(typeof (globalThis as {document?:unknown}).document!=='undefined')
  throw new Error('ACCESS_SERVER_ENTRY_IN_BROWSER: import @mpfrontend/access-react/server only from server code');

/** The snapshot this request may use, or why it may use none. Only `ok` grants anything. */
export type AccessResult=Readonly<{ok:true;access:PageAccess}>|Readonly<{ok:false;reason:AccessRefusal|'UNAVAILABLE'}>;
export type AccessLoaderOptions<Request extends object>=Readonly<{
  /**
   * Reads the snapshot from the consumer's own endpoint through the BFF, forwarding the request's session. The
   * consumer's server has already resolved its rules into explicit grants; this package decides none.
   */
  load:(request:Request,signal:AbortSignal)=>Promise<unknown>;
  /** The context reference this request is in; a snapshot of another context, or of none, is refused. */
  contextRef:(request:Request)=>string|undefined|Promise<string|undefined>;
  /** Every key the app knows (manifestKeys of its page manifest); a snapshot that names another key is refused. */
  keys:AccessKeys;
  /** The time bound of one load, in milliseconds. */
  timeoutMs:number;
  now?:()=>number;
}>;

/**
 * A server-only loader. It loads, validates (shape, revision, expiry, context reference, known keys) and memoizes the
 * snapshot once per request object: pass the same object for one request, for example the headers of a server
 * component's request. A failed or slow load, and a malformed, expired or mismatched snapshot, grant nothing.
 */
export function createAccessLoader<Request extends object>(options:AccessLoaderOptions<Request>):(request:Request)=>Promise<AccessResult>{
  if(!Number.isInteger(options.timeoutMs)||options.timeoutMs<=0)throw new Error('ACCESS_LOAD_TIMEOUT_REQUIRED');
  const memo=new WeakMap<Request,Promise<AccessResult>>();
  const read=async(request:Request):Promise<AccessResult>=>{
    const signal=AbortSignal.timeout(options.timeoutMs);
    try{
      const timedOut=new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
      const [value,contextRef]=await Promise.race([Promise.all([options.load(request,signal),options.contextRef(request)]),timedOut]);
      if(contextRef===undefined)return {ok:false,reason:'CONTEXT_MISMATCH'};
      return parsePageAccess(value,{now:(options.now??Date.now)(),contextRef,keys:options.keys});
    }catch{
      return {ok:false,reason:'UNAVAILABLE'};
    }
  };
  return request=>{
    let pending=memo.get(request);
    if(!pending){pending=read(request);memo.set(request,pending);}
    return pending;
  };
}

/**
 * The part of the result that a provider receives: only the listed keys, never identity or token data. null when the
 * result grants nothing, which the provider treats as a missing snapshot.
 */
export function clientSnapshot(result:AccessResult,keys:AccessKeys):PageAccess|null{
  return result.ok?pickPageAccess(result.access,keys):null;
}
