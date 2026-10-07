import {createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID} from 'node:crypto';
import {createClient} from '@redis/client';
import {runtimeBudget,type RuntimeBudgetPolicy,type SharedRuntimeLimits} from './runtime-limits.js';
export type {RuntimeBudgetPolicy,SharedRuntimeLimits,ConnectionBudget} from './runtime-limits.js';

export type VaultKind = 'session' | 'transaction';
export type VaultRecord<T> = {value:T; revision:string; expiresAt:number};
/** Implementations must be shared and atomic; never emulate CAS with GET followed by SET. */
export interface SessionVault {
  readonly profile:'memory-development'|'redis-validation';
  read<T>(kind:VaultKind,id:string):Promise<VaultRecord<T>|undefined>;
  create<T>(kind:VaultKind,id:string,value:T,expiresAt:number):Promise<void>;
  consume<T>(kind:VaultKind,id:string):Promise<VaultRecord<T>|undefined>;
  remove(kind:VaultKind,id:string):Promise<void>;
  acquire(id:string,owner:string,leaseMs:number):Promise<boolean>;
  release(id:string,owner:string):Promise<void>;
  update<T>(id:string,expected:VaultRecord<T>,value:T,owner:string):Promise<boolean>;
  healthy():Promise<boolean>;
}
export function createMemorySessionVault():SessionVault {
  const records=new Map<string,VaultRecord<unknown>>(),locks=new Map<string,{owner:string;until:number}>();
  const key=(kind:VaultKind,id:string)=>kind+':'+id;
  const read=<T>(kind:VaultKind,id:string)=>{
    const record=records.get(key(kind,id));
    if(record&&record.expiresAt<=Date.now()){records.delete(key(kind,id));return undefined;}
    return record?structuredClone(record) as VaultRecord<T>:undefined;
  };
  return {
    profile:'memory-development',
    async read<T>(kind:VaultKind,id:string){return read<T>(kind,id);},
    async create(kind,id,value,expiresAt){
      for(const[k,r]of records)if(r.expiresAt<=Date.now())records.delete(k);
      if(records.size>=2000)throw Object.assign(new Error('VAULT_LIMIT'),{status:429});
      if(read(kind,id))throw new Error('RECORD_EXISTS');
      records.set(key(kind,id),{value:structuredClone(value),expiresAt,revision:randomUUID()});
    },
    async consume<T>(kind:VaultKind,id:string){const result=read<T>(kind,id);records.delete(key(kind,id));return result;},
    async remove(kind,id){records.delete(key(kind,id));},
    async acquire(id,owner,leaseMs){
      const lock=locks.get(id);if(lock&&lock.until>Date.now())return false;
      locks.set(id,{owner,until:Date.now()+leaseMs});return true;
    },
    async release(id,owner){if(locks.get(id)?.owner===owner)locks.delete(id);},
    async update(id,expected,value,owner){
      const lock=locks.get(id),current=read('session',id);
      if(!lock||lock.owner!==owner||lock.until<=Date.now()||current?.revision!==expected.revision)return false;
      records.set(key('session',id),{value:structuredClone(value),expiresAt:expected.expiresAt,revision:randomUUID()});return true;
    },
    async healthy(){return true;}
  };
}

export type RedisVaultConfig={url:string;namespace:string;activeKeyId:string;keys:Readonly<Record<string,Uint8Array>>;budget?:Partial<RuntimeBudgetPolicy>};
/** Validation profile only. Deployment TLS/ACL, HA durability and key custody are separate acceptance gates. */
export async function createRedisSessionVault(config:RedisVaultConfig):Promise<SessionVault & {limits:SharedRuntimeLimits;close():Promise<void>}> {
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(config.namespace))throw new Error('INVALID_VAULT_NAMESPACE');
  const keys=new Map(Object.entries(config.keys).map(([id,key])=>{
    if(!/^[a-zA-Z0-9_-]{1,32}$/.test(id)||key.byteLength!==32)throw new Error('INVALID_VAULT_KEY');
    return [id,Buffer.from(key)] as const;
  }));
  if(!keys.has(config.activeKeyId))throw new Error('ACTIVE_VAULT_KEY_REQUIRED');
  const client=createClient({url:config.url,disableOfflineQueue:true,
    socket:{connectTimeout:2000,reconnectStrategy:false},commandOptions:{timeout:2000}});
  // No URL, credentials, ciphertext, tokens or provider errors in application logs.
  const policy=Object.freeze(runtimeBudget(config.budget));
  client.on('error',()=>undefined);
  try{await client.connect();}catch{if(client.isOpen)client.destroy();throw new Error('SESSION_STORE_UNAVAILABLE');}
  // One hash slot permits atomic record + refresh-lock scripts on Redis Cluster.
  const prefix=`mpfrontend:{${config.namespace}}:`;
  const policyKey=prefix+'budget-policy',encodedPolicy=JSON.stringify(policy);
  // Replicas must not disagree on their shared quota. Deliberate policy migration is deployment work.
  try{
    await client.set(policyKey,encodedPolicy,{NX:true});
    if(await client.get(policyKey)!==encodedPolicy)throw new Error('RUNTIME_BUDGET_POLICY_MISMATCH');
  }catch(error){if(client.isOpen)client.destroy();throw new Error((error as Error).message==='RUNTIME_BUDGET_POLICY_MISMATCH'?'RUNTIME_BUDGET_POLICY_MISMATCH':'SESSION_STORE_UNAVAILABLE');}
  const address=(kind:VaultKind|'lock',id:string)=>prefix+kind+':'+createHash('sha256').update(id).digest('hex');
  const seal=(address:string,record:VaultRecord<unknown>)=>{
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',keys.get(config.activeKeyId)!,iv);
    cipher.setAAD(Buffer.from(address));
    const ciphertext=Buffer.concat([cipher.update(JSON.stringify(record),'utf8'),cipher.final()]);
    return [config.activeKeyId,iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),ciphertext.toString('base64url')].join('.');
  };
  const open=<T>(address:string,raw:string):VaultRecord<T>=>{
    try{
      const [kid,iv,tag,payload,...extra]=raw.split('.');
      if(!kid||!iv||!tag||!payload||extra.length||!keys.has(kid))throw new Error();
      const decipher=createDecipheriv('aes-256-gcm',keys.get(kid)!,Buffer.from(iv,'base64url'));
      decipher.setAAD(Buffer.from(address));decipher.setAuthTag(Buffer.from(tag,'base64url'));
      const record=JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload,'base64url')),decipher.final()]).toString()) as VaultRecord<T>;
      if(typeof record.revision!=='string'||!Number.isFinite(record.expiresAt)||!('value' in record))throw new Error();
      return record;
    }catch{throw new Error('SESSION_STORE_INTEGRITY_FAILURE');}
  };
  const safely=async<T>(operation:()=>Promise<T>):Promise<T>=>{
    try{return await operation();}catch(error){
      if((error as Error).message==='SESSION_STORE_INTEGRITY_FAILURE')throw error;
      throw new Error('SESSION_STORE_UNAVAILABLE');
    }
  };
  const time="local t=redis.call('TIME'); local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000); ";
  const subjectKey=(category:string,subject:string)=>prefix+category+':'+createHash('sha256').update(subject).digest('hex');
  const connectionKeys=(subject:string)=>[prefix+'connections',subjectKey('connections-subject',subject)];
  const limits:SharedRuntimeLimits={policy,
    async take(category,subject){return safely(async()=>{
      const ticket=category==='ticket',window=ticket?policy.ticketWindowMs:policy.loginWindowMs;
      return await client.eval(time+
        "for _,key in ipairs(KEYS) do redis.call('ZREMRANGEBYSCORE',key,'-inf',now-tonumber(ARGV[1])) end; "+
        "if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[3]) then return 0 end; "+
        "for _,key in ipairs(KEYS) do redis.call('ZADD',key,now,ARGV[4]); redis.call('PEXPIRE',key,ARGV[1]) end; return 1",
        {keys:[prefix+'rate-'+category,subjectKey('rate-'+category,subject)],
          arguments:[String(window),String(ticket?policy.tickets:policy.logins),String(ticket?policy.ticketsPerSession:policy.loginsPerPeer),randomUUID()]})===1;
    });},
    connections:{
      async reserve(subject,id){return safely(async()=>{
        const result=await client.eval(time+
          "for _,key in ipairs(KEYS) do redis.call('ZREMRANGEBYSCORE',key,'-inf',now) end; "+
          "if redis.call('ZSCORE',KEYS[1],ARGV[1]) or redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[2]) or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[3]) then return 0 end; "+
          "for _,key in ipairs(KEYS) do redis.call('ZADD',key,now+tonumber(ARGV[4]),ARGV[1]); redis.call('PEXPIRE',key,ARGV[4]) end; return tonumber(ARGV[4])",
          {keys:connectionKeys(subject),arguments:[id,String(policy.connections),String(policy.connectionsPerSession),String(policy.connectionLeaseMs)]});
        return typeof result==='number'&&result>0?result:undefined;
      });},
      async renew(subject,id){return safely(async()=>{
        const result=await client.eval(time+
          "local a=redis.call('ZSCORE',KEYS[1],ARGV[1]); local b=redis.call('ZSCORE',KEYS[2],ARGV[1]); "+
          "if not a or not b or tonumber(a)<=now or tonumber(b)<=now then return 0 end; "+
          "for _,key in ipairs(KEYS) do redis.call('ZADD',key,now+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',key,ARGV[2]) end; return tonumber(ARGV[2])",
          {keys:connectionKeys(subject),arguments:[id,String(policy.connectionLeaseMs)]});
        return typeof result==='number'&&result>0?result:undefined;
      });},
      async release(subject,id){await safely(async()=>{await client.eval(
        "if not redis.call('ZSCORE',KEYS[2],ARGV[1]) then return 0 end; for _,key in ipairs(KEYS) do redis.call('ZREM',key,ARGV[1]) end; return 1",
        {keys:connectionKeys(subject),arguments:[id]});});}
    }
  };
  return {
    profile:'redis-validation',
    limits,
    async read<T>(kind:VaultKind,id:string){return safely(async()=>{
      const key=address(kind,id),raw=await client.get(key);if(!raw)return undefined;
      const record=open<T>(key,raw);return record.expiresAt>Date.now()?record:undefined;
    });},
    async create(kind,id,value,expiresAt){await safely(async()=>{
      const key=address(kind,id),ttl=expiresAt-Date.now();if(ttl<=0)throw new Error();
      if(await client.set(key,seal(key,{value,revision:randomUUID(),expiresAt}),{PX:ttl,NX:true})!=='OK')throw new Error();
    });},
    async consume<T>(kind:VaultKind,id:string){return safely(async()=>{
      const key=address(kind,id),raw=await client.getDel(key);if(!raw)return undefined;
      const record=open<T>(key,raw);return record.expiresAt>Date.now()?record:undefined;
    });},
    async remove(kind,id){await safely(async()=>{await client.del(address(kind,id));});},
    async acquire(id,owner,leaseMs){return safely(async()=>await client.set(address('lock',id),owner,{NX:true,PX:leaseMs})==='OK');},
    async release(id,owner){await safely(async()=>{await client.eval(
      "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
      {keys:[address('lock',id)],arguments:[owner]});});},
    async update(id,expected,value,owner){return safely(async()=>{
      const key=address('session',id),raw=await client.get(key);
      if(!raw||open(key,raw).revision!==expected.revision)return false;
      const ttl=expected.expiresAt-Date.now();if(ttl<=0)return false;
      const next=seal(key,{value,revision:randomUUID(),expiresAt:expected.expiresAt});
      return await client.eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] and redis.call('GET',KEYS[2]) == ARGV[2] then redis.call('SET',KEYS[2],ARGV[3],'PX',ARGV[4]); return 1 end return 0",
        {keys:[address('lock',id),key],arguments:[owner,raw,next,String(ttl)]})===1;
    });},
    async healthy(){return safely(async()=>await client.ping()==='PONG');},
    async close(){if(client.isOpen)client.destroy();}
  };
}
