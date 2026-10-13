export type ConnectionState = 'idle'|'connecting'|'authenticating'|'live'|'backoff'|'resyncing'|'closed';
export {SnapshotRecovery} from './snapshot-recovery.js';
export type Invalidation = Readonly<{v:1;type:'invalidate';eventId:string;contextRef:string;accessRevision:string;resource:string;cursor:string}>;
export class RealtimeContext {
  state:ConnectionState='idle';
  private seen=new Set<string>();
  private generation=0;
  checkpoint:string|undefined;
  constructor(readonly contextRef:string,readonly accessRevision:string,readonly dedupeLimit=256) {
    if (!contextRef || !accessRevision || !Number.isInteger(dedupeLimit) || dedupeLimit<1) throw new Error('INVALID_CONTEXT');
  }
  begin():number { if(this.state==='closed') throw new Error('CLOSED_CONTEXT'); this.state='connecting';return this.generation; }
  admit():void { if(this.state!=='connecting' && this.state!=='authenticating') throw new Error('INVALID_TRANSITION');this.state='live'; }
  disconnect():void { if(this.state!=='closed') this.state='backoff'; }
  accept(frame:Invalidation):boolean {
    if(this.state!=='live' || frame.v!==1 || frame.contextRef!==this.contextRef || frame.accessRevision!==this.accessRevision || this.seen.has(frame.eventId)) return false;
    this.seen.add(frame.eventId);
    if(this.seen.size>this.dedupeLimit) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  snapshotCompleted(cursor:string,generation:number):boolean { if(this.state==='closed' || generation!==this.generation) return false;this.checkpoint=cursor;return true; }
  invalidateAuthority():void { this.generation++;this.state='closed';this.seen.clear();this.checkpoint=undefined; }
}
export function reconnectDelay(attempt:number,random = Math.random):number {
  const ceiling=Math.min(30_000,500*2**Math.min(Math.max(attempt,0),16));
  // Equal jitter preserves desynchronization without allowing an unlucky client to consume the
  // complete per-session admission budget before its one-minute window can roll forward.
  return Math.floor(ceiling/2+random()*ceiling/2);
}
