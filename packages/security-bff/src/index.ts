import {createHash,createPublicKey,randomBytes,randomUUID,sign as signData,verify,timingSafeEqual,type JsonWebKey,type KeyObject} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createPreferenceCookie,negotiateLocale,type PreferenceCookieContract} from '@mpfrontend/i18n';
import {createMemorySessionVault,type SessionVault} from './session-store.js';
export type {VaultSecurity} from './session-store.js';

/**
 * A route may require a recent sign-in (`maxAge`, seconds since the person authenticated) and, optionally,
 * an authentication context class (`acr`, the values that count). A consumer may use maxAge alone.
 */
export type AuthenticationRequirement=Readonly<{maxAge?:number;acr?:readonly string[]}>;
/** The typed answer when the current sign-in is not enough; it never names the provider's origin. */
export type StepUpChallenge=Readonly<{maxAge?:number;acrValues?:readonly string[];login:string;resubmit:'idempotent'|'manual'}>;
export type ApiRoute={method:string;pattern:RegExp;roles?:readonly string[];origin:string;prefix?:string;authentication?:AuthenticationRequirement;invoke?:(input:{path:string;headers:Readonly<Record<string,string>>;body:Uint8Array|undefined})=>Promise<{status:number;body:unknown}>};
/** The locales the BFF may send upstream as Accept-Language; anything else becomes the default. */
export type ApiLocales=Readonly<{supported:readonly string[];defaultLocale:string}>;
/** The previous behaviour: only en and ar were ever forwarded, en by default. */
export const defaultApiLocales:ApiLocales=Object.freeze({supported:Object.freeze(['en','ar']),defaultLocale:'en'});
type CommonConfig={publicOrigin:string;issuer:string;providerOrigin?:string;clientId:string;audience:string;cookieName:string;routes:readonly ApiRoute[];requireTenant?:boolean;tenantExemptRoles?:readonly string[];supportedUiLocales?:readonly string[];uiLocaleCookie?:string;apiLocales?:ApiLocales;contextClaims?:readonly string[];contextClaimSource?:'id'|'access';preferenceCookie?:PreferenceCookieContract;session?:SessionPolicy;
  /** Enables POST /backchannel-logout (OpenID Connect Back-Channel Logout 1.0); expose it only on the provider's network path. */
  backChannelLogout?:boolean;
  /** The acr values a step-up may request; without this list a login cannot request an acr. */
  acrValues?:readonly string[];
  /** The paths the browser may return to after sign-in; '/' when unset. A string matches exactly. */
  returnPaths?:readonly (string|RegExp)[];loginRateLimit?:(peer:string)=>Promise<boolean>};
/**
 * How the BFF authenticates to the token endpoint. A public client sends only its client id; the
 * production profile accepts it only when the configuration declares it explicitly.
 */
export type ClientAuthentication=
  | Readonly<{method:'none';publicClient:true}>
  | Readonly<{method:'client_secret_basic';secret:string|(()=>string)}>
  | Readonly<{method:'private_key_jwt';key:SigningKey|(()=>SigningKey)}>;
/**
 * A private key held by the host, identified by its key id so that the identity provider can rotate keys:
 * a function returns the current key at each use. The package never stores, logs or returns it.
 */
export type SigningKey=Readonly<{keyId:string;privateKey:KeyObject;algorithm?:'RS256'|'PS256'|'ES256'}>;
/** A client assertion lives this long (RFC 7523 recommends a short lifetime). */
export const CLIENT_ASSERTION_LIFETIME_SECONDS=60;
function signingKey(source:SigningKey|(()=>SigningKey)):SigningKey{
  const key=typeof source==='function'?source():source;
  if(!key||typeof key.keyId!=='string'||!/^[\x21-\x7e]{1,128}$/.test(key.keyId)||key.privateKey?.type!=='private')throw new Error('INVALID_CLIENT_SIGNING_KEY');
  const algorithm=key.algorithm??(key.privateKey.asymmetricKeyType==='ec'?'ES256':'RS256');
  const type=key.privateKey.asymmetricKeyType;
  if(!((algorithm==='ES256'&&type==='ec')||((algorithm==='RS256'||algorithm==='PS256')&&(type==='rsa'||type==='rsa-pss'))))throw new Error('INVALID_CLIENT_SIGNING_KEY');
  return {...key,algorithm};
}
/** A private_key_jwt client assertion (RFC 7523 section 3): iss and sub are the client, aud the token endpoint. */
export function clientAssertion(clientId:string,audience:string,source:SigningKey|(()=>SigningKey),now=Date.now()):string{
  const key=signingKey(source),issued=Math.floor(now/1000);
  const header=Buffer.from(JSON.stringify({alg:key.algorithm,kid:key.keyId,typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:clientId,sub:clientId,aud:audience,jti:randomUUID(),iat:issued,exp:issued+CLIENT_ASSERTION_LIFETIME_SECONDS})).toString('base64url');
  const input=Buffer.from(header+'.'+payload);
  const signature=key.algorithm==='ES256'?signData('sha256',input,{key:key.privateKey,dsaEncoding:'ieee-p1363'})
    :key.algorithm==='PS256'?signData('sha256',input,{key:key.privateKey,padding:6,saltLength:32}):signData('sha256',input,key.privateKey);
  return header+'.'+payload+'.'+signature.toString('base64url');
}
/** Today's single-process development profile, refused when NODE_ENV is production. */
export type DevelopmentBffConfig=CommonConfig&{development:true;production?:never;sessionVault?:SessionVault;clientAuthentication?:ClientAuthentication};
/** Every field is required; createBff refuses to start, with a named reason, when a condition does not hold. */
export type ProductionProfile=Readonly<{sessionVault:SessionVault;clientAuthentication:ClientAuthentication;secureCookies:true;
  /** The session cookie carries the __Host- prefix unless this is false. */
  hostPrefix?:boolean}>;
export type ProductionBffConfig=CommonConfig&{production:ProductionProfile;development?:never};
export type BffConfig=DevelopmentBffConfig|ProductionBffConfig;
/** The unmet conditions of a production configuration, in a stable order; empty when it may start. */
export function productionRefusals(config:ProductionBffConfig):string[]{
  const refusals:string[]=[],profile=config.production as Partial<ProductionProfile>|undefined;
  const https=(value:string|undefined)=>{try{return value!==undefined&&new URL(value).protocol==='https:';}catch{return false;}};
  if(!https(config.publicOrigin))refusals.push('HTTPS_PUBLIC_ORIGIN_REQUIRED');
  if(!https(config.issuer)||(config.providerOrigin!==undefined&&!https(config.providerOrigin)))refusals.push('HTTPS_IDENTITY_PROVIDER_REQUIRED');
  const security=profile?.sessionVault?.security;
  if(!security?.durable)refusals.push('DURABLE_SESSION_VAULT_REQUIRED');
  if(!security?.tls)refusals.push('SESSION_VAULT_TLS_REQUIRED');
  if(!security?.authenticated)refusals.push('SESSION_VAULT_AUTHENTICATION_REQUIRED');
  if(!security?.hostKeyRing)refusals.push('HOST_KEY_RING_REQUIRED');
  const client=profile?.clientAuthentication;
  // A public client counts only when the configuration declares it explicitly.
  const configured=client?.method==='none'?client.publicClient===true
    :client?.method==='client_secret_basic'?client.secret!==undefined&&client.secret!==''
    :client?.method==='private_key_jwt'?client.key!==undefined:false;
  if(!configured)refusals.push('CLIENT_AUTHENTICATION_REQUIRED');
  if(profile?.secureCookies!==true)refusals.push('SECURE_COOKIES_REQUIRED');
  return refusals;
}
type Claims={iss:string;aud:string|string[];azp?:string;sub:string;exp:number;iat:number;nbf?:number;nonce?:string;preferred_username?:string;tenant_id?:string;realm_access?:{roles?:string[]};[claim:string]:unknown};
/**
 * The session cookie and lifetimes. SameSite applies to the session cookie only; the short login transaction
 * cookie stays Lax so that the provider's redirect back can carry it. Lifetimes have bounded maxima; a value
 * above a maximum refuses startup rather than being shortened.
 */
export type SessionPolicy=Readonly<{sameSite?:'Strict'|'Lax';idleTimeoutSeconds?:number;absoluteLifetimeSeconds?:number;
  /** Claims whose change at refresh rotates the session id. */
  authorizationClaims?:readonly string[]}>;
export const SESSION_LIMITS=Object.freeze({defaultIdleTimeoutSeconds:1800,maxIdleTimeoutSeconds:86400,defaultAbsoluteLifetimeSeconds:28800,maxAbsoluteLifetimeSeconds:604800});
export const defaultAuthorizationClaims:readonly string[]=Object.freeze(['realm_access','resource_access','groups','scope','tenant_id']);
/** A projected claim value: plain data only, never an object, never a token. */
export type ClaimValue=string|number|boolean|readonly string[];
type Session={access:string;refresh:string;claims:Claims;identity?:Readonly<Record<string,ClaimValue>>;csrf:string;expires:number;absoluteExpires:number;lastSeen?:number;sid?:string;authTime?:number;acr?:string};
type Transaction={verifier:string;nonce:string;expires:number;maxAge?:number;acr?:string[];returnTo?:string};
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
  if('production' in config&&config.production!==undefined){
    // No condition falls back: a missing one refuses startup and names what is missing.
    const refusals=productionRefusals(config);
    if(refusals.length)throw new Error('PRODUCTION_PROFILE_REFUSED:'+refusals.join(','));
  }else if(config.development!==true||process.env.NODE_ENV==='production')throw new Error('DURABLE_SESSION_STORE_REQUIRED');
  const production='production' in config&&config.production!==undefined?config.production:undefined;
  const publicOrigin=origin(config.publicOrigin),issuer=config.issuer.replace(/\/$/,'');
  const providerOrigin=config.providerOrigin?origin(config.providerOrigin):new URL(issuer).origin;
  if(!/^(?:__Host-)?[a-z][a-z0-9_]{1,60}$/.test(config.cookieName))throw new Error('INVALID_COOKIE_NAME');
  const supportedUiLocales=new Set(config.supportedUiLocales??[]);
  if([...supportedUiLocales].some(value=>!/^[-a-zA-Z0-9]{2,16}$/.test(value)))throw new Error('INVALID_UI_LOCALE');
  if(config.uiLocaleCookie&&!/^[a-z][a-z0-9_]{1,60}$/.test(config.uiLocaleCookie))throw new Error('INVALID_UI_LOCALE_COOKIE');
  const contextClaims=[...(config.contextClaims??[])],claimSource=config.contextClaimSource??'id';
  if(contextClaims.length>32||new Set(contextClaims).size!==contextClaims.length||contextClaims.some(name=>!/^[a-zA-Z][a-zA-Z0-9_:.-]{0,63}$/.test(name)||/token/i.test(name)||['at_hash','c_hash','nonce'].includes(name)))throw new Error('INVALID_CONTEXT_CLAIMS');
  if(claimSource!=='id'&&claimSource!=='access')throw new Error('INVALID_CONTEXT_CLAIMS');
  const preferences=config.preferenceCookie?createPreferenceCookie(config.preferenceCookie):undefined;
  const backChannel=config.backChannelLogout===true;
  const acrToken=/^[\x21-\x7e]{1,128}$/;
  const acrAllowlist=new Set(config.acrValues??[]);
  if([...acrAllowlist].some(value=>!acrToken.test(value)))throw new Error('INVALID_ACR_VALUES');
  const returnPaths=config.returnPaths??['/'];
  for(const route of config.routes){
    const requirement=route.authentication;
    if(!requirement)continue;
    if(requirement.maxAge!==undefined&&(!Number.isSafeInteger(requirement.maxAge)||requirement.maxAge<0||requirement.maxAge>86400))throw new Error('INVALID_ROUTE_AUTHENTICATION');
    if(requirement.acr!==undefined&&(!requirement.acr.length||requirement.acr.some(value=>!acrAllowlist.has(value))))throw new Error('INVALID_ROUTE_AUTHENTICATION');
  }
  /** A same-origin path from the allowlist, or undefined: never another origin, never a protocol-relative path. */
  const returnPath=(value:string|null)=>{
    if(value===null)return undefined;
    if(value.length>512||!/^\/(?![/\\])[^\s\\]*$/.test(value))return null;
    let parsed:URL;try{parsed=new URL(value,publicOrigin);}catch{return null;}
    if(parsed.origin!==publicOrigin)return null;
    return returnPaths.some(path=>typeof path==='string'?path===parsed.pathname:path.test(parsed.pathname))?parsed.pathname+parsed.search:null;
  };
  /** The step-up the current session needs for a requirement, or undefined when it is enough. */
  const needsStepUp=(value:Session,requirement:AuthenticationRequirement|undefined)=>{
    if(!requirement)return false;
    const stale=requirement.maxAge!==undefined&&(value.authTime===undefined||(value.authTime+requirement.maxAge)*1000<Date.now());
    const weak=requirement.acr!==undefined&&(value.acr===undefined||!requirement.acr.includes(value.acr));
    return stale||weak;
  };
  const stepUp=(res:ServerResponse,requirement:AuthenticationRequirement,resubmit:'idempotent'|'manual')=>{
    const query=new URLSearchParams();
    if(requirement.maxAge!==undefined)query.set('max_age',String(requirement.maxAge));
    if(requirement.acr)query.set('acr_values',requirement.acr.join(' '));
    const challenge:StepUpChallenge={...(requirement.maxAge!==undefined?{maxAge:requirement.maxAge}:{}),...(requirement.acr?{acrValues:[...requirement.acr]}:{}),
      login:'/api/session/login'+(query.size?'?'+query:''),resubmit};
    write(res,401,{type:'about:blank',status:401,title:'STEP_UP_REQUIRED',stepUp:challenge});
  };
  /** An RFC 9470 challenge of an upstream API, reduced to the values the step-up needs. */
  const upstreamStepUp=(header:string|null):AuthenticationRequirement|undefined=>{
    if(!header||!/^Bearer\s/i.test(header))return undefined;
    const parameters=Object.fromEntries([...header.matchAll(/([a-z_]+)="([^"]*)"/gi)].map(match=>[match[1]!.toLowerCase(),match[2]!]));
    if(parameters.error!=='insufficient_user_authentication')return undefined;
    const maxAge=parameters.max_age!==undefined&&/^\d{1,5}$/.test(parameters.max_age)?Number(parameters.max_age):undefined;
    const acr=parameters.acr_values?.split(' ').filter(value=>acrAllowlist.has(value));
    if(maxAge===undefined&&!acr?.length)return undefined;
    return {...(maxAge!==undefined?{maxAge}:{}),...(acr?.length?{acr}:{})};
  };
  const apiLocales=config.apiLocales??defaultApiLocales;
  if(!apiLocales.supported.length||apiLocales.supported.some(value=>!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value))||!apiLocales.supported.includes(apiLocales.defaultLocale))throw new Error('INVALID_API_LOCALES');
  for(const route of config.routes){origin(route.origin);if(route.pattern.global||route.pattern.sticky)throw new Error('STATEFUL_ROUTE_PATTERN');}
  // Production never uses the memory vault; development keeps it as its default.
  const vault=production?production.sessionVault:(config as DevelopmentBffConfig).sessionVault??createMemorySessionVault();
  let keys:{kid:string;jwk:JsonWebKey}[]=[],keysUntil=0;
  // __Host-: Secure, Path=/ and no Domain, so no other host or path can set or read the session cookie.
  const productionPrefix=production!==undefined&&production.hostPrefix!==false;
  const sessionCookie=config.cookieName.startsWith('__Host-')||!productionPrefix?config.cookieName:'__Host-'+config.cookieName;
  if(sessionCookie.startsWith('__Host-')&&!publicOrigin.startsWith('https:'))throw new Error('HOST_PREFIX_REQUIRES_HTTPS');
  const transactionCookie=sessionCookie+'_login';
  const policy=config.session??{};
  const sameSite=policy.sameSite??(production?'Strict':'Lax');
  const idleSeconds=policy.idleTimeoutSeconds??SESSION_LIMITS.defaultIdleTimeoutSeconds;
  const absoluteSeconds=policy.absoluteLifetimeSeconds??SESSION_LIMITS.defaultAbsoluteLifetimeSeconds;
  if(sameSite!=='Strict'&&sameSite!=='Lax')throw new Error('INVALID_SESSION_POLICY');
  if(!Number.isSafeInteger(idleSeconds)||idleSeconds<60||idleSeconds>SESSION_LIMITS.maxIdleTimeoutSeconds)throw new Error('INVALID_SESSION_POLICY');
  if(!Number.isSafeInteger(absoluteSeconds)||absoluteSeconds<300||absoluteSeconds>SESSION_LIMITS.maxAbsoluteLifetimeSeconds||idleSeconds>absoluteSeconds)throw new Error('INVALID_SESSION_POLICY');
  const authorizationClaims=[...(policy.authorizationClaims??defaultAuthorizationClaims)];
  const authority=(claims:Readonly<Record<string,unknown>>)=>JSON.stringify(authorizationClaims.map(name=>claims[name]??null));
  // Activity is recorded at most this often, so that an idle timeout does not cost a write per request.
  const touchMs=Math.min(60000,idleSeconds*100);
  const secure=production!==undefined||publicOrigin.startsWith('https:');
  const cookie=(name:string,value:string,maxAge:number,site:'Strict'|'Lax'='Lax')=>name+'='+value+'; HttpOnly; SameSite='+site+'; Path=/; Max-Age='+maxAge+(secure||name.startsWith('__Host-')?'; Secure':'');
  const sessionSetCookie=(id:string,maxAge:number)=>cookie(sessionCookie,id,maxAge,sameSite);
  const provider=(path:string)=>providerOrigin+new URL(issuer).pathname+'/protocol/openid-connect/'+path;
  async function identityResponse(path:string,options:RequestInit={}){
    let response:Response;
    try{response=await fetch(provider(path),{...options,redirect:'error',signal:AbortSignal.timeout(8000)});}
    catch{throw new IdentityUnavailable();}
    if(response.status===429||response.status>=500)throw new IdentityUnavailable();
    return response;
  }
  async function validate(token:string,audience:string,nonce?:string,subjectOptional=false):Promise<Claims>{
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
    if(claims.iss!==issuer||(!claims.sub&&!subjectOptional)||(claims.sub!==undefined&&typeof claims.sub!=='string')||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.iat)||claims.iat>now+30||(claims.nbf!==undefined&&claims.nbf>now+30)||!(Array.isArray(claims.aud)?claims.aud.includes(audience):claims.aud===audience))fail(401,'INVALID_TOKEN');
    if(audience===config.clientId&&((Array.isArray(claims.aud)&&claims.aud.length>1&&!claims.azp)||(claims.azp&&claims.azp!==config.clientId)))fail(401,'INVALID_TOKEN');
    if(nonce!==undefined&&claims.nonce!==nonce)fail(401,'INVALID_NONCE');
    return claims;
  }
  if(backChannel&&(!vault.indexSession||!vault.revokeIndexed))throw new Error('BACKCHANNEL_LOGOUT_VAULT_UNSUPPORTED');
  /** Indexes a session by the provider's session id and by subject, for back-channel logout. */
  async function index(id:string,value:Session){
    if(backChannel)await vault.indexSession!(id,{...(value.sid?{sid:value.sid}:{}),sub:value.claims.sub},value.absoluteExpires);
  }
  const clientAuthentication=production?production.clientAuthentication:(config as DevelopmentBffConfig).clientAuthentication;
  if(clientAuthentication?.method==='private_key_jwt')signingKey(clientAuthentication.key);
  if(clientAuthentication?.method==='client_secret_basic'&&(typeof clientAuthentication.secret==='string'?!clientAuthentication.secret:typeof clientAuthentication.secret!=='function'))throw new Error('INVALID_CLIENT_SECRET');
  // The assertion audience is the token endpoint as the issuer names it, not an internal provider origin.
  const tokenEndpoint=issuer+'/protocol/openid-connect/token';
  /** Client authentication for a request to the provider; the credential goes only into this request. */
  function authenticate(parameters:URLSearchParams):Record<string,string>{
    parameters.set('client_id',config.clientId);
    if(clientAuthentication?.method==='client_secret_basic'){
      const secret=typeof clientAuthentication.secret==='function'?clientAuthentication.secret():clientAuthentication.secret;
      // RFC 6749 section 2.3.1: both parts are form-urlencoded before Base64.
      const encode=(value:string)=>encodeURIComponent(value).replace(/%20/g,'+');
      return {authorization:'Basic '+Buffer.from(encode(config.clientId)+':'+encode(secret)).toString('base64')};
    }
    if(clientAuthentication?.method==='private_key_jwt'){
      parameters.set('client_assertion_type','urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      parameters.set('client_assertion',clientAssertion(config.clientId,tokenEndpoint,clientAuthentication.key));
    }
    return {};
  }
  async function tokenRequest(parameters:URLSearchParams){
    const headers=authenticate(parameters);
    const response=await identityResponse('token',{method:'POST',body:parameters,headers});
    if(!response.ok)fail(401,'LOGIN_REQUIRED');
    const result=await response.json() as {access_token:string;refresh_token:string;id_token?:string};
    if(!result.access_token||!result.refresh_token)fail(401,'INVALID_TOKEN_RESPONSE');return result;
  }
  async function session(req:IncomingMessage,refresh=true):Promise<{id:string;value:Session;rotated?:boolean}>{
    const id=cookieValue(req.headers.cookie,sessionCookie);
    if(!id||!/^[-_a-zA-Z0-9]{43}$/.test(id))fail(401,'LOGIN_REQUIRED');
    const deadline=Date.now()+10000;
    for(;;){
      const record=await vault.read<Session>('session',id),value=record?.value;
      if(!record||!value||value.absoluteExpires<=Date.now())fail(401,'LOGIN_REQUIRED');
      // An idle session fails closed and is removed; activity is the last authenticated request.
      if((value.lastSeen??Date.now())+idleSeconds*1000<=Date.now()){await vault.remove('session',id);fail(401,'LOGIN_REQUIRED');}
      const stale=Date.now()-(value.lastSeen??0)>=touchMs;
      if(!refresh||value.expires>=Date.now()+30000){
        if(!stale)return {id,value};
        // Record activity under the lease; a busy lease means another request is already writing.
        const owner=opaque();
        if(!await vault.acquire(id,owner,30000))return {id,value};
        try{
          const current=await vault.read<Session>('session',id);
          if(!current)fail(401,'LOGIN_REQUIRED');
          const next={...current.value,lastSeen:Date.now()};
          return {id,value:await vault.update(id,current,next,owner)?next:current.value};
        }finally{await vault.release(id,owner);}
      }
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
        const next={...current.value,access:tokens.access_token,refresh:tokens.refresh_token,claims,...(identity?{identity}:{}),expires:claims.exp*1000,lastSeen:Date.now()};
        if(authority(claims)!==authority(current.value.claims)){
          // Changed roles or authorization claims rotate the session id: a new record, the old one removed.
          const rotated=opaque();
          await vault.create('session',rotated,next,current.value.absoluteExpires);
          await index(rotated,next);
          await vault.remove('session',id);
          return {id:rotated,value:next,rotated:true};
        }
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
  /**
   * OpenID Connect Back-Channel Logout 1.0: a signed logout token from the issuer ends every session of its
   * provider session id (sid), or of its subject when it carries no sid. Nothing is listed or returned.
   */
  async function backChannelLogout(req:IncomingMessage,res:ServerResponse){
    if(req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')fail(400,'INVALID_LOGOUT_TOKEN');
    const token=new URLSearchParams((await body(req)).toString('utf8')).get('logout_token');
    let claims:Claims;
    try{
      if(!token)throw new Error();
      // A logout token names a sid, a subject or both (section 2.4).
      claims=await validate(token,config.clientId,undefined,true);
      if(typeof claims.sub!=='string'&&typeof claims.sid!=='string')throw new Error();
      const events=claims.events as Record<string,unknown>|undefined;
      const event=events?.['http://schemas.openid.net/event/backchannel-logout'];
      if(!event||typeof event!=='object'||Array.isArray(event))throw new Error();
      if('nonce' in claims)throw new Error();
      if(typeof claims.jti!=='string'||!claims.jti||claims.jti.length>256)throw new Error();
      if(claims.sid!==undefined&&(typeof claims.sid!=='string'||!claims.sid||claims.sid.length>256))throw new Error();
      // A logout token is accepted for a bounded time after it was issued.
      if(claims.iat<Math.floor(Date.now()/1000)-300)throw new Error();
    }catch(error){
      if(error instanceof IdentityUnavailable)throw error;
      fail(400,'INVALID_LOGOUT_TOKEN');
    }
    const replayKey='logout-token:'+issuer+'\u0000'+String(claims.jti);
    // Revocation is idempotent; the token is recorded only after it, so that a store outage can be retried.
    if(await vault.read('transaction',replayKey))fail(400,'INVALID_LOGOUT_TOKEN');
    if(typeof claims.sid==='string')await vault.revokeIndexed!('sid',claims.sid);
    else await vault.revokeIndexed!('sub',claims.sub);
    await vault.create('transaction',replayKey,true,Date.now()+360000).catch(async error=>{if(await vault.read('transaction',replayKey))return;throw error;});
    res.writeHead(200,{'cache-control':'no-store'});res.end();
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
        // A step-up names a recent sign-in, acceptable acr values and the allowlisted path to return to.
        const maxAgeParameter=url.searchParams.get('max_age'),acrParameter=url.searchParams.get('acr_values');
        const maxAge=maxAgeParameter===null?undefined:/^\d{1,5}$/.test(maxAgeParameter)&&Number(maxAgeParameter)<=86400?Number(maxAgeParameter):fail(400,'INVALID_STEP_UP');
        const acr=acrParameter===null?undefined:acrParameter.split(' ');
        if(acr&&(!acr.length||acr.length>8||acr.some(value=>!acrAllowlist.has(value))))fail(400,'INVALID_STEP_UP');
        const returnTo=returnPath(url.searchParams.get('return_to'));
        if(returnTo===null)fail(400,'INVALID_RETURN_PATH');
        const state=opaque(),verifier=opaque(),nonce=opaque(),expires=Date.now()+300000;
        await vault.create('transaction',state,{verifier,nonce,expires,...(maxAge!==undefined?{maxAge}:{}),...(acr?{acr}:{}),...(returnTo?{returnTo}:{})},expires);
        const redirect=new URL(issuer+'/protocol/openid-connect/auth');
        const parameters=new URLSearchParams({client_id:config.clientId,response_type:'code',prompt:'login',scope:'openid profile',redirect_uri:publicOrigin+'/api/session/callback',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
        if(maxAge!==undefined)parameters.set('max_age',String(maxAge));
        if(acr)parameters.set('acr_values',acr.join(' '));
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
        // A requested step-up is accepted only when the new ID token proves it; nothing is lowered.
        const authTime=typeof identity.auth_time==='number'&&Number.isFinite(identity.auth_time)?identity.auth_time:undefined;
        const acrClaim=typeof identity.acr==='string'?identity.acr:undefined;
        if(transaction.maxAge!==undefined&&(authTime===undefined||(authTime+transaction.maxAge)*1000+30000<Date.now()))fail(401,'STEP_UP_FAILED');
        if(transaction.acr&&(acrClaim===undefined||!transaction.acr.includes(acrClaim)))fail(401,'STEP_UP_FAILED');
        // Sign-in always issues a new session id; a session id from before sign-in is removed.
        const old=cookieValue(req.headers.cookie,sessionCookie);if(old)await vault.remove('session',old);
        const id=opaque(),absoluteExpires=Date.now()+absoluteSeconds*1000;
        const projected=projectClaims(claimSource==='id'?identity:claims,contextClaims);
        const created:Session={access:tokens.access_token,refresh:tokens.refresh_token,claims,identity:projected,csrf:opaque(),expires:claims.exp*1000,absoluteExpires,lastSeen:Date.now(),
          ...(authTime!==undefined?{authTime}:{}),...(acrClaim!==undefined?{acr:acrClaim}:{}),
          ...(typeof identity.sid==='string'&&identity.sid.length<=256?{sid:identity.sid}:{})};
        await vault.create('session',id,created,absoluteExpires);
        await index(id,created);
        const cookies=[sessionSetCookie(id,absoluteSeconds),cookie(transactionCookie,'',0)];
        if(sameSite==='Strict'){
          // A Strict cookie set at the end of a cross-site redirect chain is not sent on the next hop of that
          // chain; a same-origin page that moves on lets the browser send it.
          res.writeHead(200,{'content-type':'text/html; charset=utf-8','set-cookie':cookies,'cache-control':'no-store','referrer-policy':'no-referrer',
            'content-security-policy':"default-src 'none'; frame-ancestors 'none'"});
          const target=(transaction.returnTo??'/').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
          res.end('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url='+target+'">');return;
        }
        res.writeHead(303,{'location':publicOrigin+(transaction.returnTo??'/'),'set-cookie':cookies,'cache-control':'no-store'});res.end();return;
      }
      if(url.pathname==='/backchannel-logout'&&method==='POST'){
        if(!backChannel)fail(404,'OPERATION_NOT_FOUND');
        await backChannelLogout(req,res);return;
      }
      const current=await session(req,!(url.pathname==='/logout'&&method==='POST'));
      if(current.rotated)res.setHeader('set-cookie',sessionSetCookie(current.id,Math.max(1,Math.floor((current.value.absoluteExpires-Date.now())/1000))));
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
        const revocation=new URLSearchParams({refresh_token:current.value.refresh});
        await Promise.resolve().then(()=>fetch(provider('logout'),{method:'POST',body:revocation,headers:authenticate(revocation),signal:AbortSignal.timeout(5000)})).catch(()=>undefined);
        res.setHeader('set-cookie',sessionSetCookie('',0));write(res,200,{authenticated:false});return;
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
      // The BFF never holds or replays a write: the presentation server resubmits it after step-up, and only
      // a request that is safe or carries an idempotency key may be resubmitted without the person.
      const resubmit=method==='GET'||idempotency?'idempotent':'manual';
      if(needsStepUp(current.value,route.authentication)){stepUp(res,route.authentication!,resubmit);return;}
      const target=new URL((route.prefix??'')+url.pathname+url.search,route.origin);
      if(target.origin!==route.origin)fail(400,'INVALID_PATH');
      const bytes=method==='GET'?undefined:await body(req);
      if(route.invoke){const reply=await route.invoke({path:url.pathname,headers,body:bytes});write(res,reply.status,reply.body);return;}
      const upstream=await fetch(target,{method,headers,...(bytes?{body:new Uint8Array(bytes)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
      const raw=await upstream.text();
      const challenge=upstream.status===401?upstreamStepUp(upstream.headers.get('www-authenticate')):undefined;
      if(challenge){stepUp(res,challenge,resubmit);return;}
      res.writeHead(upstream.status,{...jsonHeaders,'x-correlation-id':requestId,...(upstream.headers.get('idempotency-replayed')?{'idempotency-replayed':'true'}:{})});res.end(raw);
    }catch(error){
      const status=(error as {status?:number}).status??503;
      write(res,status,{type:'about:blank',status,title:status===503?'SERVICE_UNAVAILABLE':(error as Error).message});
    }
  };
}
