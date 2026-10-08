import {createHash,createPublicKey,randomBytes,verify,timingSafeEqual,type JsonWebKey} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createPreferenceCookie,negotiateLocale,type PreferenceCookieContract} from '@mpfrontend/i18n';
import {createMemorySessionVault,type SessionVault} from './session-store.js';

export type ApiRoute={method:string;pattern:RegExp;roles?:readonly string[];origin:string;prefix?:string;invoke?:(input:{path:string;headers:Readonly<Record<string,string>>;body:Uint8Array|undefined})=>Promise<{status:number;body:unknown}>};
/** The locales the BFF may send upstream as Accept-Language; anything else becomes the default. */
export type ApiLocales=Readonly<{supported:readonly string[];defaultLocale:string}>;
/** The previous behaviour: only en and ar were ever forwarded, en by default. */
export const defaultApiLocales:ApiLocales=Object.freeze({supported:Object.freeze(['en','ar']),defaultLocale:'en'});
export type BffConfig={publicOrigin:string;issuer:string;providerOrigin?:string;clientId:string;audience:string;cookieName:string;routes:readonly ApiRoute[];requireTenant?:boolean;tenantExemptRoles?:readonly string[];supportedUiLocales?:readonly string[];uiLocaleCookie?:string;apiLocales?:ApiLocales;contextClaims?:readonly string[];contextClaimSource?:'id'|'access';preferenceCookie?:PreferenceCookieContract;development:true;sessionVault?:SessionVault;loginRateLimit?:(peer:string)=>Promise<boolean>};
type Claims={iss:string;aud:string|string[];azp?:string;sub:string;exp:number;iat:number;nbf?:number;nonce?:string;preferred_username?:string;tenant_id?:string;realm_access?:{roles?:string[]};[claim:string]:unknown};
/** A projected claim value: plain data only, never an object, never a token. */
export type ClaimValue=string|number|boolean|readonly string[];
type Session={access:string;refresh:string;claims:Claims;identity?:Readonly<Record<string,ClaimValue>>;csrf:string;expires:number;absoluteExpires:number};
type Transaction={verifier:string;nonce:string;expires:number};
const opaque=()=>randomBytes(32).toString('base64url');
const jsonHeaders={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
function equal(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function cookieValue(header:string|undefined,name:string){return header?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);}
function origin(value:string){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('INVALID_ORIGIN');return u.origin;}
function fail(status:number,code:string):never{throw Object.assign(new Error(code),{status});}
// Only this private transport/status classification can retain a refresh record. Generic503 errors
// (vault integrity, malformed responses, failed validation or CAS) must never gain this exception.
class IdentityUnavailable extends Error {
  readonly status=503;
  constructor(){super('IDENTITY_UNAVAILABLE');}
}
const MAX_PROJECTION=4096,compactToken=/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
/** The allowlisted claims for /context, bounded in size. A token, an object or an oversized value is left out. */
export function projectClaims(claims:Readonly<Record<string,unknown>>,allowed:readonly string[]):Readonly<Record<string,ClaimValue>>{
  const projection:Record<string,ClaimValue>={};let size=2;
  const plain=(value:unknown):value is string|number|boolean=>typeof value==='number'?Number.isFinite(value):typeof value==='boolean'||(typeof value==='string'&&value.length<=512&&!compactToken.test(value));
  for(const name of allowed){
    const value=claims[name];
    const accepted=plain(value)?value:Array.isArray(value)&&value.length<=16&&value.every(entry=>typeof entry==='string'&&entry.length<=128&&!compactToken.test(entry))?Object.freeze([...value] as string[]):undefined;
    if(accepted===undefined)continue;
    const cost=JSON.stringify(name).length+JSON.stringify(accepted).length+2;
    if(size+cost>MAX_PROJECTION)continue;
    size+=cost;projection[name]=accepted;
  }
  return Object.freeze(projection);
}
function write(res:ServerResponse,status:number,body:unknown){res.writeHead(status,jsonHeaders);res.end(JSON.stringify(body));}
async function body(req:IncomingMessage){const chunks:Buffer[]=[];let size=0;for await(const raw of req){const chunk=Buffer.from(raw);size+=chunk.length;if(size>65536)fail(413,'BODY_TOO_LARGE');chunks.push(chunk);}return Buffer.concat(chunks);}
export function createBff(config:BffConfig){
  if(config.development!==true||process.env.NODE_ENV==='production')throw new Error('DURABLE_SESSION_STORE_REQUIRED');
  const publicOrigin=origin(config.publicOrigin),issuer=config.issuer.replace(/\/$/,'');
  const providerOrigin=config.providerOrigin?origin(config.providerOrigin):new URL(issuer).origin;
  if(!/^[a-z][a-z0-9_]{1,60}$/.test(config.cookieName))throw new Error('INVALID_COOKIE_NAME');
  const supportedUiLocales=new Set(config.supportedUiLocales??[]);
  if([...supportedUiLocales].some(value=>!/^[-a-zA-Z0-9]{2,16}$/.test(value)))throw new Error('INVALID_UI_LOCALE');
  if(config.uiLocaleCookie&&!/^[a-z][a-z0-9_]{1,60}$/.test(config.uiLocaleCookie))throw new Error('INVALID_UI_LOCALE_COOKIE');
  const contextClaims=[...(config.contextClaims??[])],claimSource=config.contextClaimSource??'id';
  if(contextClaims.length>32||new Set(contextClaims).size!==contextClaims.length||contextClaims.some(name=>!/^[a-zA-Z][a-zA-Z0-9_:.-]{0,63}$/.test(name)||/token/i.test(name)||['at_hash','c_hash','nonce'].includes(name)))throw new Error('INVALID_CONTEXT_CLAIMS');
  if(claimSource!=='id'&&claimSource!=='access')throw new Error('INVALID_CONTEXT_CLAIMS');
  const preferences=config.preferenceCookie?createPreferenceCookie(config.preferenceCookie):undefined;
  const apiLocales=config.apiLocales??defaultApiLocales;
  if(!apiLocales.supported.length||apiLocales.supported.some(value=>!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value))||!apiLocales.supported.includes(apiLocales.defaultLocale))throw new Error('INVALID_API_LOCALES');
  for(const route of config.routes){origin(route.origin);if(route.pattern.global||route.pattern.sticky)throw new Error('STATEFUL_ROUTE_PATTERN');}
  const vault=config.sessionVault??createMemorySessionVault();
  let keys:{kid:string;jwk:JsonWebKey}[]=[],keysUntil=0;
  const transactionCookie=config.cookieName+'_login';
  const cookie=(name:string,value:string,maxAge:number)=>name+'='+value+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+maxAge+(publicOrigin.startsWith('https:')?'; Secure':'');
  const provider=(path:string)=>providerOrigin+new URL(issuer).pathname+'/protocol/openid-connect/'+path;
  async function identityResponse(path:string,options:RequestInit={}){
    let response:Response;
    try{response=await fetch(provider(path),{...options,redirect:'error',signal:AbortSignal.timeout(8000)});}
    catch{throw new IdentityUnavailable();}
    if(response.status===429||response.status>=500)throw new IdentityUnavailable();
    return response;
  }
  async function validate(token:string,audience:string,nonce?:string):Promise<Claims>{
    const parts=token.split('.');if(parts.length!==3)fail(401,'INVALID_TOKEN');
    const header=JSON.parse(Buffer.from(parts[0]!,'base64url').toString()) as {alg:string;kid:string};
    if(header.alg!=='RS256'||!header.kid)fail(401,'INVALID_TOKEN');
    if(Date.now()>keysUntil||!keys.some(k=>k.kid===header.kid)){
      const response=await identityResponse('certs');
      if(!response.ok)fail(401,'INVALID_IDENTITY_RESPONSE');
      const jwks=await response.json() as {keys:(JsonWebKey&{kid:string;alg?:string;use?:string})[]};
      keys=jwks.keys.filter(k=>k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig')).map(jwk=>({kid:jwk.kid,jwk}));keysUntil=Date.now()+60000;
    }
    const key=keys.find(k=>k.kid===header.kid);
    if(!key||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:key.jwk,format:'jwk'}),Buffer.from(parts[2]!,'base64url')))fail(401,'INVALID_TOKEN');
    const claims=JSON.parse(Buffer.from(parts[1]!,'base64url').toString()) as Claims,now=Math.floor(Date.now()/1000);
    if(claims.iss!==issuer||!claims.sub||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||(claims.nbf!==undefined&&claims.nbf>now+30)||!(Array.isArray(claims.aud)?claims.aud.includes(audience):claims.aud===audience))fail(401,'INVALID_TOKEN');
    if(audience===config.clientId&&((Array.isArray(claims.aud)&&claims.aud.length>1&&!claims.azp)||(claims.azp&&claims.azp!==config.clientId)))fail(401,'INVALID_TOKEN');
    if(nonce!==undefined&&claims.nonce!==nonce)fail(401,'INVALID_NONCE');
    return claims;
  }
  async function tokenRequest(parameters:URLSearchParams){
    parameters.set('client_id',config.clientId);
    const response=await identityResponse('token',{method:'POST',body:parameters});
    if(!response.ok)fail(401,'LOGIN_REQUIRED');
    const result=await response.json() as {access_token:string;refresh_token:string;id_token?:string};
    if(!result.access_token||!result.refresh_token)fail(401,'INVALID_TOKEN_RESPONSE');return result;
  }
  async function session(req:IncomingMessage,refresh=true){
    const id=cookieValue(req.headers.cookie,config.cookieName);
    if(!id||!/^[-_a-zA-Z0-9]{43}$/.test(id))fail(401,'LOGIN_REQUIRED');
    const deadline=Date.now()+10000;
    for(;;){
      const record=await vault.read<Session>('session',id),value=record?.value;
      if(!record||!value||value.absoluteExpires<=Date.now())fail(401,'LOGIN_REQUIRED');
      if(!refresh||value.expires>=Date.now()+30000)return {id,value};
      const owner=opaque();
      if(!await vault.acquire(id,owner,30000)){
        if(Date.now()>=deadline)fail(503,'SESSION_REFRESH_BUSY');
        await delay(50);continue;
      }
      try{
        // Another replica may have refreshed or revoked after our first read.
        const current=await vault.read<Session>('session',id);
        if(!current)fail(401,'LOGIN_REQUIRED');
        if(current.value.expires>=Date.now()+30000)return {id,value:current.value};
        const tokens=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',refresh_token:current.value.refresh}));
        const claims=await validate(tokens.access_token,config.audience);
        if(claims.sub!==current.value.claims.sub||claims.tenant_id!==current.value.claims.tenant_id)fail(401,'SESSION_CHANGED');
        // The projection follows a refreshed ID token of the same subject, or the refreshed access token.
        let identity=current.value.identity;
        if(claimSource==='access')identity=projectClaims(claims,contextClaims);
        else if(tokens.id_token){const refreshed=await validate(tokens.id_token,config.clientId);if(refreshed.sub!==claims.sub)fail(401,'SESSION_CHANGED');identity=projectClaims(refreshed,contextClaims);}
        const next={...current.value,access:tokens.access_token,refresh:tokens.refresh_token,claims,...(identity?{identity}:{}),expires:claims.exp*1000};
        // CAS requires both the original revision and the still-owned lease. Logout cannot be undone.
        if(!await vault.update(id,current,next,owner))fail(401,'LOGIN_REQUIRED');
        return {id,value:next};
      }catch(error){
        // Fail the current request; do not serve cached claims/access during an outage. Keep only the
        // unchanged verified record/absolute TTL. No retry or saving an unverified rotated token.
        if(!(error instanceof IdentityUnavailable))await vault.remove('session',id);
        throw error;
      }
      finally{await vault.release(id,owner);}
    }
  }
  return async function handle(req:IncomingMessage,res:ServerResponse){
    try{
      const url=new URL(req.url??'/',publicOrigin),method=req.method??'GET';
      if(url.pathname==='/health'&&method==='GET'){
        if(!await vault.healthy())fail(503,'SESSION_STORE_UNAVAILABLE');
        write(res,200,{status:'ready',profile:vault.profile});return;
      }
      if(url.pathname==='/login'&&method==='GET'){
        // No unverified forwarded IP/header is trusted. The peer is the trusted presentation host.
        if(config.loginRateLimit&&!await config.loginRateLimit(req.socket.remoteAddress??'unknown'))fail(429,'LOGIN_LIMIT');
        const state=opaque(),verifier=opaque(),nonce=opaque(),expires=Date.now()+300000;
        await vault.create('transaction',state,{verifier,nonce,expires},expires);
        const redirect=new URL(issuer+'/protocol/openid-connect/auth');
        const parameters=new URLSearchParams({client_id:config.clientId,response_type:'code',prompt:'login',scope:'openid profile',redirect_uri:publicOrigin+'/api/session/callback',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        // The query wins, then the preference cookie's language, then the older whole-value locale cookie.
        const uiLocale=url.searchParams.get('ui_locales')??preferences?.read(req.headers.cookie).lang??(config.uiLocaleCookie?cookieValue(req.headers.cookie,config.uiLocaleCookie):undefined);
        if(uiLocale&&supportedUiLocales.has(uiLocale))parameters.set('ui_locales',uiLocale);
        redirect.search=parameters.toString();
        res.writeHead(302,{'location':redirect.href,'set-cookie':cookie(transactionCookie,state,300),'cache-control':'no-store'});res.end();return;
      }
      if(url.pathname==='/callback'&&method==='GET'){
        const state=url.searchParams.get('state')??'',saved=cookieValue(req.headers.cookie,transactionCookie)??'';
        if(!/^[-_a-zA-Z0-9]{43}$/.test(state)||!equal(state,saved))fail(401,'INVALID_LOGIN_STATE');
        const transaction=(await vault.consume<Transaction>('transaction',state))?.value;
        if(!transaction||transaction.expires<=Date.now())fail(401,'INVALID_LOGIN_STATE');
        const code=url.searchParams.get('code');if(!code)fail(401,'LOGIN_FAILED');
        const tokens=await tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,code_verifier:transaction.verifier,redirect_uri:publicOrigin+'/api/session/callback'}));
        if(!tokens.id_token)fail(401,'ID_TOKEN_REQUIRED');
        const identity=await validate(tokens.id_token,config.clientId,transaction.nonce),claims=await validate(tokens.access_token,config.audience);
        if(identity.sub!==claims.sub||(config.requireTenant&&!claims.tenant_id&&!config.tenantExemptRoles?.some(role=>claims.realm_access?.roles?.includes(role))))fail(401,'INVALID_IDENTITY');
        const old=cookieValue(req.headers.cookie,config.cookieName);if(old)await vault.remove('session',old);
        const id=opaque(),absoluteExpires=Date.now()+8*3600000;
        const projected=projectClaims(claimSource==='id'?identity:claims,contextClaims);
        await vault.create('session',id,{access:tokens.access_token,refresh:tokens.refresh_token,claims,identity:projected,csrf:opaque(),expires:claims.exp*1000,absoluteExpires},absoluteExpires);
        res.writeHead(303,{'location':publicOrigin+'/','set-cookie':[cookie(config.cookieName,id,28800),cookie(transactionCookie,'',0)],'cache-control':'no-store'});res.end();return;
      }
      const current=await session(req,!(url.pathname==='/logout'&&method==='POST'));
      if(method!=='GET'){
        if(req.headers.origin!==publicOrigin||typeof req.headers['x-csrf-token']!=='string'||!equal(current.value.csrf,req.headers['x-csrf-token']))fail(403,'CSRF_REJECTED');
        if(req.headers['content-type']?.split(';')[0]!=='application/json')fail(415,'JSON_REQUIRED');
      }
      if(url.pathname==='/context'&&method==='GET'){
        const c=current.value.claims;write(res,200,{authenticated:true,subject:c.sub,name:c.preferred_username??c.sub,roles:c.realm_access?.roles??[],tenant:c.tenant_id??null,claims:current.value.identity??{},csrf:current.value.csrf,expiresAt:current.value.absoluteExpires});return;
      }
      if(url.pathname==='/logout'&&method==='POST'){
        await vault.remove('session',current.id);
        // Revoke the server-held refresh token; local logout succeeds even when the provider is down.
        await fetch(provider('logout'),{method:'POST',body:new URLSearchParams({client_id:config.clientId,refresh_token:current.value.refresh}),signal:AbortSignal.timeout(5000)}).catch(()=>undefined);
        res.setHeader('set-cookie',cookie(config.cookieName,'',0));write(res,200,{authenticated:false});return;
      }
      // An explicit route per operation; URL normalization and redirects cannot escape the allowlist.
      const route=config.routes.find(r=>r.method===method&&r.pattern.test(url.pathname));
      if(!route)fail(404,'OPERATION_NOT_FOUND');
      if(route.roles&&!route.roles.some(role=>current.value.claims.realm_access?.roles?.includes(role)))fail(403,'FORBIDDEN');
      // Only an allowlisted token is ever sent upstream; the browser's header is never forwarded as given.
      const headers:Record<string,string>={authorization:'Bearer '+current.value.access,'Accept-Language':negotiateLocale(req.headers['accept-language'],apiLocales.supported,apiLocales.defaultLocale)};
      const requestId=opaque();headers['X-Correlation-ID']=requestId;
      if(method!=='GET')headers['content-type']='application/json';
      const idempotency=req.headers['idempotency-key'];
      if(idempotency){if(typeof idempotency!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(idempotency))fail(400,'INVALID_IDEMPOTENCY_KEY');headers['Idempotency-Key']=idempotency;}
      const target=new URL((route.prefix??'')+url.pathname+url.search,route.origin);
      if(target.origin!==route.origin)fail(400,'INVALID_PATH');
      const bytes=method==='GET'?undefined:await body(req);
      if(route.invoke){const reply=await route.invoke({path:url.pathname,headers,body:bytes});write(res,reply.status,reply.body);return;}
      const upstream=await fetch(target,{method,headers,...(bytes?{body:new Uint8Array(bytes)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
      const raw=await upstream.text();
      res.writeHead(upstream.status,{...jsonHeaders,'x-correlation-id':requestId,...(upstream.headers.get('idempotency-replayed')?{'idempotency-replayed':'true'}:{})});res.end(raw);
    }catch(error){
      const status=(error as {status?:number}).status??503;
      write(res,status,{type:'about:blank',status,title:status===503?'SERVICE_UNAVAILABLE':(error as Error).message});
    }
  };
}
