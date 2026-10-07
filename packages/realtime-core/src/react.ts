'use client';
import {useEffect,useRef,useState} from 'react';
import {RealtimeContext,SnapshotRecovery,reconnectDelay,type ConnectionState,type Invalidation} from './index.js';

export type RealtimeSession={subject:string;tenant:string|null;roles:readonly string[];csrf:string};
export type RealtimeUnavailable=Readonly<{phase:'ticket'|'transport'|'snapshot';status?:number}>;
export type RealtimeOptions={session:RealtimeSession|null;resources:readonly string[];
  /** Resolve only after protected reads finish; check signal before applying their results. */
  onSnapshot:(resources:readonly string[],signal:AbortSignal)=>Promise<void>;
  /** Notification only. Drafts must never be overwritten by an invalidation. */
  onInvalidate?:(resource:string)=>void;onRevoked?:()=>void;
  /** Optional bounded diagnostic. Never contains tickets, identity, payloads or provider errors. */
  onUnavailable?:(fault:RealtimeUnavailable)=>void};
export function useRealtime(options:RealtimeOptions){
  const [state,setState]=useState<ConnectionState>('idle');
  const callbacks=useRef(options);useEffect(()=>{callbacks.current=options;});
  const sessionKey=options.session?JSON.stringify([options.session.subject,options.session.tenant,[...options.session.roles].sort(),options.session.csrf]):'';
  const resourcesKey=JSON.stringify([...new Set(options.resources)].sort());
  useEffect(()=>{
    const resources=JSON.parse(resourcesKey) as string[];
    if(!sessionKey||!resources.length){setState('idle');return;}
    const csrf=(JSON.parse(sessionKey) as [string,string|null,string[],string])[3];
    const lifetime=new AbortController();
    let stopped=false,socket:WebSocket|undefined,timer:ReturnType<typeof setTimeout>|undefined,attempt=0;
    let context:RealtimeContext|undefined,recovery:SnapshotRecovery|undefined;
    function unavailable(fault:RealtimeUnavailable){
      try{callbacks.current.onUnavailable?.(Object.freeze(fault));}catch{/* Observers cannot control recovery. */}
    }
    async function connect(){
      if(stopped)return;setState(attempt?'resyncing':'connecting');
      let phase:'ticket'|'transport'='ticket';
      try{
        const reply=await fetch('/api/realtime/ticket',{method:'POST',headers:{'X-CSRF-Token':csrf},cache:'no-store',signal:AbortSignal.any([lifetime.signal,AbortSignal.timeout(8000)])});
        if(reply.status===401||reply.status===403){stopped=true;setState('closed');callbacks.current.onRevoked?.();return;}
        if(!reply.ok){unavailable({phase:'ticket',status:reply.status});retry();return;}
        const ticket=await reply.json() as {ticket:string};
        if(stopped)return;
        const endpoint=new URL('/api/realtime',location.href);endpoint.protocol=location.protocol==='https:'?'wss:':'ws:';
        phase='transport';const active=new WebSocket(endpoint);socket=active;
        let reported=false;
        const report=(fault:RealtimeUnavailable)=>{if(!reported){reported=true;unavailable(fault);}};
        active.onopen=()=>{if(stopped||socket!==active)return;setState('authenticating');active.send(JSON.stringify({v:1,type:'subscribe',ticket:ticket.ticket,resources}));};
        active.onmessage=event=>{
          if(stopped||socket!==active)return;
          try{
            const frame=JSON.parse(String(event.data)) as Omit<Invalidation,'type'>&{type:string;recovery?:string};
            if(frame.v!==1||typeof frame.contextRef!=='string'||typeof frame.accessRevision!=='string')throw new Error('INVALID_FRAME');
            if(frame.type==='ready'){
              if(context||frame.recovery!=='snapshot')throw new Error('INVALID_ADMISSION');
              context=new RealtimeContext(frame.contextRef,frame.accessRevision);context.begin();context.admit();
              recovery=new SnapshotRecovery(resources,{
                snapshot:(batch,signal)=>callbacks.current.onSnapshot(batch,signal),
                state:next=>{if(stopped||socket!==active)return;if(next==='live')attempt=0;setState(next);},
                // WHATWG browser close() only accepts1000 or3000..4999;1013 is server-only.
                failure:()=>{if(!stopped&&socket===active){report({phase:'snapshot'});active.close(4013,'SNAPSHOT_UNAVAILABLE');}}
              });
              recovery.recover();return;
            }
            if(!context||frame.contextRef!==context.contextRef||frame.accessRevision!==context.accessRevision)return;
            if(frame.type==='resync-required'){recovery?.recover();return;}
            if(frame.type==='invalidate'&&typeof frame.eventId==='string'&&typeof frame.resource==='string'&&typeof frame.cursor==='string'&&resources.includes(frame.resource)&&context.accept({...frame,type:'invalidate'})){
              callbacks.current.onInvalidate?.(frame.resource);recovery?.invalidate(frame.resource);
            }
          }catch{active.close(4002,'INVALID_FRAME');}
        };
        active.onerror=()=>{if(stopped||socket!==active)return;report({phase:'transport'});active.close();};
        active.onclose=event=>{
          if(socket!==active)return;socket=undefined;recovery?.close();recovery=undefined;context?.invalidateAuthority();context=undefined;
          if(stopped)return;if(event.code===4003){stopped=true;setState('closed');callbacks.current.onRevoked?.();return;}
          report({phase:'transport'});retry();
        };
      }catch{if(!stopped)unavailable({phase});retry();}
    }
    function retry(){if(stopped)return;if(timer)clearTimeout(timer);setState('backoff');timer=setTimeout(()=>void connect(),reconnectDelay(attempt++));}
    void connect();
    return()=>{stopped=true;lifetime.abort();if(timer)clearTimeout(timer);recovery?.close();context?.invalidateAuthority();socket?.close(1000,'CONTEXT_CLOSED');};
  },[sessionKey,resourcesKey]);
  return state;
}
