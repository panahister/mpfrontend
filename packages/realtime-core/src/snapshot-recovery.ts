/** Bounded, subscribe-before-snapshot recovery. Invalidation carries no protected payload. */
export class SnapshotRecovery {
  private pending=new Set<string>();
  private running=false;
  private closed=false;
  private controller:AbortController|undefined;
  private readonly resources:Set<string>;
  constructor(resources:readonly string[],private readonly options:{
    snapshot:(resources:readonly string[],signal:AbortSignal)=>Promise<void>;
    state:(state:'resyncing'|'live')=>void;
    failure:(error:unknown)=>void;
    timeoutMs?:number;
  }){
    this.resources=new Set(resources);
    if(!this.resources.size||this.resources.size>6||[...this.resources].some(v=>!v||v.length>80))throw new Error('INVALID_RESOURCES');
    const timeout=options.timeoutMs??10000;
    if(!Number.isSafeInteger(timeout)||timeout<1||timeout>120000)throw new Error('INVALID_SNAPSHOT_TIMEOUT');
  }
  recover(){if(this.closed)return;for(const resource of this.resources)this.pending.add(resource);this.start();}
  invalidate(resource:string){if(this.closed||!this.resources.has(resource))return;this.pending.add(resource);this.start();}
  close(){this.closed=true;this.pending.clear();this.controller?.abort();}
  private start(){
    if(this.running)return;
    this.running=true;this.options.state('resyncing');
    void this.drain().catch(error=>{if(this.closed)return;this.close();this.options.failure(error);});
  }
  private async drain(){
    while(!this.closed&&this.pending.size){
      const batch=[...this.pending];this.pending.clear();
      const controller=new AbortController();this.controller=controller;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const aborted=new Promise<never>((_,reject)=>{
        controller.signal.addEventListener('abort',()=>reject(new Error('SNAPSHOT_ABORTED')),{once:true});
        timer=setTimeout(()=>controller.abort(),this.options.timeoutMs??10000);
      });
      try{await Promise.race([this.options.snapshot(batch,controller.signal),aborted]);}
      finally{if(timer)clearTimeout(timer);}
    }
    this.running=false;if(!this.closed)this.options.state('live');
  }
}
