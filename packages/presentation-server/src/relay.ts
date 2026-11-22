/**
 * The relay of a streamed BFF route for a presentation application's route handlers (Web Request and
 * Response, as in Next.js). It passes the request body to the BFF and the answer back to the browser as
 * streams in both directions, never holding a whole body, and it forwards only what the BFF checks, the
 * content headers and a valid Accept. It decides nothing itself: the BFF's allowlist, session, Origin, CSRF,
 * size and negotiation rules do.
 */

/** The request headers the relay forwards: what the BFF checks, and the content headers of a body. */
export const RELAY_REQUEST_HEADERS=Object.freeze(['origin','x-csrf-token','idempotency-key','accept-language','content-type','content-length'] as const);
/** The response headers the relay passes back: the content headers and the BFF's own safety and correlation headers. */
export const RELAY_RESPONSE_HEADERS=Object.freeze(['content-type','content-length','content-disposition','content-security-policy',
  'x-content-type-options','cache-control','x-correlation-id','idempotency-replayed'] as const);

export type RelayOptions=Readonly<{
  /** The BFF's origin on the trusted server-to-server path. */
  bffOrigin:string;
  /** The BFF path under which the streamed routes live, for example `/<app>/transfer`. */
  basePath:string;
  /** The name of the BFF's session cookie: the only cookie the relay forwards, and the only one it passes back. */
  sessionCookie:string;
}>;
export type Relay=(request:Request,segments:readonly string[])=>Promise<Response>;

function checkedOrigin(value:string){
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_ORIGIN');
  return url.origin;
}
function cookieValue(header:string|null,name:string){
  return header?.split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='))?.slice(name.length+1);
}
/** The longest Accept value the relay forwards, in characters. */
const ACCEPT_MAX_LENGTH=1024;
const mediaRange=/^(?:\*\/\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/(?:\*|[a-z0-9][a-z0-9!#$&^_.+-]{0,126}))$/i;
const acceptParameter=/^[a-z0-9!#$%&'*+.^_`|~-]+=[a-z0-9!#$%&'*+.^_`|~-]+$/i;
const weight=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;
const ows=(value:string)=>value.replace(/^[ \t]+|[ \t]+$/g,'');
/**
 * Whether an Accept value is a list of media ranges (RFC 9110 section 12.5.1) of bounded length: each range has unquoted
 * parameters only, and a weight `q` from 0 to 1 with at most three decimals. An empty element or a quoted value is not read.
 */
function validAccept(value:string){
  if(value.length>ACCEPT_MAX_LENGTH)return false;
  return value.split(',').every(element=>{
    const [range,...parameters]=element.split(';').map(ows);
    return range!==undefined&&mediaRange.test(range)&&parameters.every(parameter=>acceptParameter.test(parameter)&&
      (parameter.slice(0,2).toLowerCase()!=='q='||weight.test(parameter.slice(2))));
  });
}
function problem(status:number,title:string){
  return new Response(JSON.stringify({type:'about:blank',status,title}),
    {status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
}

/**
 * A relay to the BFF routes under `basePath`. Each path segment is encoded again, so that a segment can never
 * leave the base path; the query string is passed as it is. A body without a length is refused by the BFF.
 */
export function createRelay(options:RelayOptions):Relay{
  const bff=checkedOrigin(options.bffOrigin);
  if(!/^(?:\/[A-Za-z0-9._~-]+)+$/.test(options.basePath)||options.basePath.split('/').some(part=>part==='.'||part==='..'))throw new Error('INVALID_RELAY_PATH');
  if(!/^(?:__Host-)?[a-z][a-z0-9_]{1,60}$/.test(options.sessionCookie))throw new Error('INVALID_SESSION_COOKIE');
  return async function relay(request,segments){
    if(!segments.length||segments.length>32||segments.some(segment=>!segment||segment==='.'||segment==='..'||segment.length>256))return problem(404,'OPERATION_NOT_FOUND');
    const search=new URL(request.url).search;
    const target=bff+options.basePath+'/'+segments.map(encodeURIComponent).join('/')+search;
    const headers=new Headers();
    for(const name of RELAY_REQUEST_HEADERS){const value=request.headers.get(name);if(value!==null)headers.set(name,value);}
    // Accept is forwarded as it is, or not at all: the BFF selects from it, and the relay never widens it.
    const accept=request.headers.get('accept');
    if(accept!==null&&validAccept(accept))headers.set('accept',accept);
    const session=cookieValue(request.headers.get('cookie'),options.sessionCookie);
    if(session!==undefined)headers.set('cookie',options.sessionCookie+'='+session);
    const withBody=request.method!=='GET'&&request.method!=='HEAD'&&request.body!==null;
    let response:Response;
    try{
      // A client that goes away aborts the call to the BFF, which ends the upstream call.
      response=await fetch(target,{method:request.method,headers,...(withBody?{body:request.body,duplex:'half'}:{}),
        redirect:'error',cache:'no-store',signal:request.signal} as RequestInit);
    }catch{return problem(503,'SERVICE_UNAVAILABLE');}
    const passed=new Headers();
    for(const name of RELAY_RESPONSE_HEADERS){const value=response.headers.get(name);if(value!==null)passed.set(name,value);}
    // The BFF sends Vary only on an answer it negotiated; the relay passes it when it is there.
    const vary=response.headers.get('vary');
    if(vary!==null)passed.set('vary',vary);
    // fetch decodes a content encoding, after which the encoded length no longer applies.
    if(response.headers.has('content-encoding'))passed.delete('content-length');
    // A rotated session id is the BFF's own cookie; no other cookie is passed back.
    for(const value of response.headers.getSetCookie())if(value.startsWith(options.sessionCookie+'='))passed.append('set-cookie',value);
    const empty=[204,205,304].includes(response.status);
    if(empty)await response.body?.cancel().catch(()=>undefined);
    return new Response(empty?null:response.body,{status:response.status,headers:passed});
  };
}
