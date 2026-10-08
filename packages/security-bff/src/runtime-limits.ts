export type RuntimeBudgetPolicy={
  connections:number;connectionsPerSession:number;connectionLeaseMs:number;
  tickets:number;ticketsPerSession:number;ticketWindowMs:number;
  logins:number;loginsPerPeer:number;loginWindowMs:number;
};
export type ConnectionBudget={
  /** True for a budget that every replica shares; the production profile refuses any other. */
  readonly shared?:boolean;
  reserve:(subject:string,id:string)=>Promise<number|undefined>;
  renew:(subject:string,id:string)=>Promise<number|undefined>;
  release:(subject:string,id:string)=>Promise<void>;
};
export type SharedRuntimeLimits={
  readonly policy:Readonly<RuntimeBudgetPolicy>;
  take:(category:'ticket'|'login',subject:string)=>Promise<boolean>;
  connections:ConnectionBudget;
};
export const defaultRuntimeBudget:Readonly<RuntimeBudgetPolicy>=Object.freeze({
  connections:32,connectionsPerSession:2,connectionLeaseMs:30000,
  tickets:256,ticketsPerSession:10,ticketWindowMs:60000,
  logins:1000,loginsPerPeer:100,loginWindowMs:60000
});
export function runtimeBudget(input:Partial<RuntimeBudgetPolicy>={}):RuntimeBudgetPolicy{
  const policy={...defaultRuntimeBudget,...input};
  for(const value of Object.values(policy))if(!Number.isSafeInteger(value)||value<1||value>3600000)throw new Error('INVALID_RUNTIME_BUDGET');
  if(policy.connectionsPerSession>policy.connections||policy.ticketsPerSession>policy.tickets||policy.loginsPerPeer>policy.logins)throw new Error('INVALID_RUNTIME_BUDGET');
  return policy;
}
