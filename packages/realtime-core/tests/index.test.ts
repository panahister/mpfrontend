import { test } from 'node:test';import assert from 'node:assert/strict';import {RealtimeContext,reconnectDelay} from '../src/index.js';
test('deduplication/context checks do not advance the snapshot cursor',()=>{const state=new RealtimeContext('c','r',2);const generation=state.begin();state.admit();state.snapshotCompleted('snapshot',generation);const frame={v:1,type:'invalidate',eventId:'1',contextRef:'c',accessRevision:'r',resource:'items',cursor:'event'} as const;assert.equal(state.accept(frame),true);assert.equal(state.accept(frame),false);assert.equal(state.accept({...frame,eventId:'2',contextRef:'old'}),false);assert.equal(state.checkpoint,'snapshot');});
test('revocation permanently rejects late work and closes context',()=>{const state=new RealtimeContext('c','r');const generation=state.begin();state.admit();state.invalidateAuthority();assert.equal(state.snapshotCompleted('late',generation),false);assert.throws(()=>state.begin(),/CLOSED/);assert.equal(state.checkpoint,undefined);});
test('reconnect backoff is bounded and cannot self-exhaust ten tickets inside one minute',()=>{
  assert.equal(reconnectDelay(0,()=>.5),375);assert.equal(reconnectDelay(99,()=>.5),22500);
  const earliestTenthAttempt=Array.from({length:9},(_,attempt)=>reconnectDelay(attempt,()=>0)).reduce((sum,value)=>sum+value,0);
  assert.equal(earliestTenthAttempt,60750);
});
