export type ConnectionBudget={
  /** True for a budget that every replica shares; the production profile refuses any other. */
  readonly shared?:boolean;
  reserve:(subject:string,id:string)=>Promise<number|undefined>;
  renew:(subject:string,id:string)=>Promise<number|undefined>;
  release:(subject:string,id:string)=>Promise<void>;
};
/** Development-only fallback; production composition must provide shared, leased admission. */
export function createMemoryConnectionBudget():ConnectionBudget{
  const leases=new Map<string,{subject:string;until:number}>(),duration=30000;
  const prune=()=>{for(const[id,lease]of leases)if(lease.until<=Date.now())leases.delete(id);};
  return {
    async reserve(subject,id){
      prune();if(leases.has(id)||leases.size>=32||[...leases.values()].filter(v=>v.subject===subject).length>=2)return undefined;
      leases.set(id,{subject,until:Date.now()+duration});return duration;
    },
    async renew(subject,id){prune();const lease=leases.get(id);if(!lease||lease.subject!==subject)return undefined;lease.until=Date.now()+duration;return duration;},
    async release(subject,id){if(leases.get(id)?.subject===subject)leases.delete(id);}
  };
}
