import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse,Server} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {createMemoryConnectionBudget,type ConnectionBudget} from './connection-budget.js';
export type {ConnectionBudget} from './connection-budget.js';

export type SocketContext={subject:string;tenant:string|null;roles:string[];csrf:string};
export type AdmissionTicket={cookieHash:string;revision:string;expires:number};
/**
 * consume must be atomic across all presentation replicas. `security` describes the vault behind a store that
 * keeps its tickets in one, as `createVaultTicketStore` of the Security BFF's session store sets it. The
 * production profile refuses a shared store that does not declare it, all three flags, because a store that
 * says nothing cannot be shown to be reached over TLS and with authentication.
 */
export type AdmissionTicketStore={readonly shared?:boolean;readonly security?:Readonly<{durable:boolean;tls:boolean;authenticated:boolean}>;issue:(id:string,ticket:AdmissionTicket)=>Promise<void>;consume:(id:string)=>Promise<AdmissionTicket|undefined>};
type CommonSocketConfig={publicOrigin:string;bffOrigin:string;resolve:(resource:string,context:SocketContext)=>string|undefined;pollMs?:number};
/** Today's single-process development profile, refused when NODE_ENV is production. */
export type DevelopmentSocketConfig=CommonSocketConfig&{development:true;production?:never;ticketStore?:AdmissionTicketStore;connectionBudget?:ConnectionBudget};
/** Shared, durable admission across replicas; no process-memory default exists in this profile. */
export type PresentationProductionProfile=Readonly<{ticketStore:AdmissionTicketStore;connectionBudget:ConnectionBudget}>;
export type ProductionSocketConfig=CommonSocketConfig&{production:PresentationProductionProfile;development?:never};
export type SocketConfig=DevelopmentSocketConfig|ProductionSocketConfig;
/** The unmet conditions of a production configuration; empty when it may start. */
export function presentationProductionRefusals(config:ProductionSocketConfig):string[]{
  const refusals:string[]=[];
  let https=false;try{https=new URL(config.publicOrigin).protocol==='https:';}catch{https=false;}
  if(!https)refusals.push('HTTPS_PUBLIC_ORIGIN_REQUIRED');
  if(config.production?.ticketStore?.shared!==true)refusals.push('SHARED_TICKET_STORE_REQUIRED');
  // A store that every replica shares is reached over a network, so it must say how: one that declares nothing is
  // refused, as the Security BFF refuses a session vault that declares nothing, instead of passing for lack of a claim.
  const declared=(security:AdmissionTicketStore['security'])=>typeof security?.durable==='boolean'&&typeof security.tls==='boolean'&&typeof security.authenticated==='boolean';
  if(config.production?.ticketStore?.shared===true&&!declared(config.production.ticketStore.security))refusals.push('TICKET_STORE_SECURITY_REQUIRED');
  // Tickets in a durable vault travel and rest under the vault's own protection, which must be TLS and authentication.
  const vault=config.production?.ticketStore?.security;
  if(vault?.durable&&vault.tls!==true)refusals.push('TICKET_STORE_TLS_REQUIRED');
  if(vault?.durable&&vault.authenticated!==true)refusals.push('TICKET_STORE_AUTHENTICATION_REQUIRED');
  if(config.production?.connectionBudget?.shared!==true)refusals.push('SHARED_CONNECTION_BUDGET_REQUIRED');
  return refusals;
}
const digest=(value:string)=>createHash('sha256').update(value).digest('base64url');
const authority=(c:SocketContext)=>digest(JSON.stringify([c.subject,c.tenant,[...c.roles].sort()]));
function checkedOrigin(value:string){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_ORIGIN');return url.origin;}
function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}

export function createPresentationRealtime(config:SocketConfig){
  const production='production' in config&&config.production!==undefined?config.production:undefined;
  if(production){
    const refusals=presentationProductionRefusals(config as ProductionSocketConfig);
    if(refusals.length)throw new Error('PRODUCTION_PROFILE_REFUSED:'+refusals.join(','));
  }else if((config as DevelopmentSocketConfig).development!==true||process.env.NODE_ENV==='production')throw new Error('DURABLE_REALTIME_PROFILE_REQUIRED');
  const development=production?undefined:config as DevelopmentSocketConfig;
  const publicOrigin=checkedOrigin(config.publicOrigin),bff=checkedOrigin(config.bffOrigin);
  const interval=Math.max(3000,config.pollMs??3000),tickets=new Map<string,AdmissionTicket>();
  const connectionBudget=production?production.connectionBudget:development?.connectionBudget??createMemoryConnectionBudget();
  const ticketStore=production?production.ticketStore:development?.ticketStore??{
    async issue(id:string,ticket:AdmissionTicket){
      for(const[key,value]of tickets)if(value.expires<=Date.now())tickets.delete(key);
      if(tickets.size>=256)throw Object.assign(new Error('TICKET_LIMIT'),{status:429});
      tickets.set(id,ticket);
    },
    async consume(id:string){const ticket=tickets.get(id);tickets.delete(id);return ticket;}
  };
  const sockets=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  async function context(cookie:string):Promise<SocketContext>{
    const response=await fetch(bff+'/context',{headers:{cookie},redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store'});
    if(response.status===401||response.status===403)throw Object.assign(new Error('LOGIN_REQUIRED'),{status:401});
    if(!response.ok)throw new Error('AUTHORITY_UNAVAILABLE');
    const c=await response.json() as SocketContext;
    if(typeof c.subject!=='string'||typeof c.csrf!=='string'||!Array.isArray(c.roles)||!c.roles.every(v=>typeof v==='string')||(c.tenant!==null&&typeof c.tenant!=='string'))throw new Error('INVALID_CONTEXT');
    return c;
  }
  async function handleHttp(req:IncomingMessage,res:ServerResponse):Promise<boolean>{
    if(new URL(req.url??'/',publicOrigin).pathname!=='/api/realtime/ticket')return false;
    try{
      if(req.method!=='POST'){json(res,405,{title:'POST_REQUIRED'});return true;}
      if(req.headers.origin!==publicOrigin){json(res,403,{title:'ORIGIN_REJECTED'});return true;}
      const cookie=req.headers.cookie??'',c=await context(cookie);
      if(typeof req.headers['x-csrf-token']!=='string'||req.headers['x-csrf-token']!==c.csrf){json(res,403,{title:'CSRF_REJECTED'});return true;}
      const ticket=randomBytes(32).toString('base64url');
      await ticketStore.issue(ticket,{cookieHash:digest(cookie),revision:authority(c),expires:Date.now()+20000});
      json(res,200,{ticket,expiresIn:20});
    }catch(e){const status=(e as {status?:number}).status??503;json(res,status,{title:status===401?'LOGIN_REQUIRED':status===429?'TICKET_LIMIT':'AUTHORITY_UNAVAILABLE'});}
    return true;
  }
  function attach(server:Server){
    server.on('upgrade',async(req,socket,head)=>{
      const url=new URL(req.url??'/',publicOrigin);
      if(url.pathname!=='/api/realtime'||url.search||req.headers.origin!==publicOrigin){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
      const cookie=req.headers.cookie??'',cookieHash=digest(cookie);
      const connectionId=randomUUID();let reserved=false,upgraded=false;
      const release=()=>connectionBudget.release(cookieHash,connectionId).catch(()=>undefined);
      try{
        const initial=await context(cookie),revision=authority(initial);
        if(sockets.clients.size>=32||!await connectionBudget.reserve(cookieHash,connectionId)){socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');return;}
        reserved=true;
        // Includes rejected WebSocket handshakes and clients which disconnect during admission.
        socket.once('close',()=>{if(!upgraded)void release();});
        if(socket.destroyed){await release();return;}
        sockets.handleUpgrade(req,socket,head,ws=>{
          upgraded=true;
          const contextRef=randomUUID(),resources=new Map<string,{path:string;hash?:string}>();let admitted=false,admitting=false,busy=false,cursor=0,alive=true;
          async function lease(){
            if(ws.readyState!==WebSocket.OPEN)return false;
            const started=performance.now();
            try{
              const duration=await connectionBudget.renew(cookieHash,connectionId);
              if(!duration||performance.now()-started>=duration){ws.close(4004,'LEASE_LOST');return false;}
              return ws.readyState===WebSocket.OPEN;
            }catch{ws.close(1013,'RUNTIME_UNAVAILABLE');return false;}
          }
          const send=async(frame:unknown)=>{if(!await lease())return;if(ws.bufferedAmount>65536){ws.close(4008,'BACKPRESSURE');return;}ws.send(JSON.stringify(frame));};
          const admission=setTimeout(()=>ws.close(4001,'ADMISSION_TIMEOUT'),5000);
          ws.on('pong',()=>{alive=true;});
          ws.on('error',()=>ws.close(1011,'TRANSPORT_ERROR'));
          ws.on('message',async(raw,binary)=>{
            try{
              if(binary||admitted||admitting)throw new Error('INVALID_FRAME');
              admitting=true;
              const frame=JSON.parse(raw.toString()) as {v:number;type:string;ticket:string;resources:string[]};
              if(frame.v!==1||frame.type!=='subscribe'||typeof frame.ticket!=='string'||!Array.isArray(frame.resources)||frame.resources.length<1||frame.resources.length>6||frame.resources.some(v=>typeof v!=='string'||v.length>80))throw new Error('INVALID_FRAME');
              if(!/^[-_a-zA-Z0-9]{43}$/.test(frame.ticket))throw new Error('INVALID_TICKET');
              const saved=await ticketStore.consume(frame.ticket);
              if(!saved||saved.expires<=Date.now()||saved.cookieHash!==cookieHash||saved.revision!==revision)throw new Error('INVALID_TICKET');
              if(authority(await context(cookie))!==revision)throw new Error('AUTHORITY_CHANGED');
              if(ws.readyState!==WebSocket.OPEN)return;
              for(const name of new Set(frame.resources)){
                const path=config.resolve(name,initial);
                if(!path||!path.startsWith('/v1/')||path.includes('..')||path.includes('#')||new URL(path,bff).origin!==bff)throw new Error('FORBIDDEN_RESOURCE');
                resources.set(name,{path});
              }
              admitted=true;clearTimeout(admission);await send({v:1,type:'ready',contextRef,accessRevision:revision,recovery:'snapshot'});void tick();
            }catch{ws.close(4003,'ADMISSION_REJECTED');}
          });
          async function tick(){
            if(!admitted||busy||ws.readyState!==WebSocket.OPEN)return;busy=true;
            try{
              if(!await lease())return;
              const current=await context(cookie);
              if(authority(current)!==revision){ws.close(4003,'AUTHORITY_CHANGED');return;}
              for(const[name,value]of resources){
                if(config.resolve(name,current)!==value.path){ws.close(4003,'RESOURCE_REVOKED');return;}
                const result=await fetch(bff+value.path,{headers:{cookie},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
                if(result.status===401||result.status===403){ws.close(4003,'RESOURCE_REVOKED');return;}
                if(!result.ok&&result.status!==404)throw new Error('SNAPSHOT_UNAVAILABLE');
                const text=await result.text();if(text.length>1048576)throw new Error('SNAPSHOT_LIMIT');
                const hash=digest(result.status+':'+text);
                if(value.hash!==hash){cursor++;await send({v:1,type:'invalidate',eventId:randomUUID(),contextRef,accessRevision:revision,resource:name,cursor:String(cursor)});value.hash=hash;}
              }
            }catch(e){if((e as {status?:number}).status===401)ws.close(4003,'LOGIN_REQUIRED');else await send({v:1,type:'resync-required',contextRef,accessRevision:revision});}
            finally{busy=false;}
          }
          const polling=setInterval(()=>void tick(),interval),heartbeat=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},30000);
          ws.on('close',()=>{clearTimeout(admission);clearInterval(polling);clearInterval(heartbeat);void release();});
        });
      }catch(e){if(reserved)await release();socket.end('HTTP/1.1 '+((e as {status?:number}).status===401?'401 Unauthorized':'503 Service Unavailable')+'\r\nConnection: close\r\n\r\n');}
    });
  }
  function close(){for(const ws of sockets.clients)ws.terminate();sockets.close();tickets.clear();}
  return {handleHttp,attach,close};
}
