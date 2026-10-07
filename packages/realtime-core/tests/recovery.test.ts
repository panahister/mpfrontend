import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {SnapshotRecovery} from '../src/index.js';

test('recovery waits for snapshots and drains bounded invalidations received during the read',async()=>{
  const batches:string[][]=[],states:string[]=[],releases:Array<()=>void>=[];
  const recovery=new SnapshotRecovery(['orders','notifications'],{snapshot:async resources=>{batches.push([...resources]);await new Promise<void>(r=>releases.push(r));},state:s=>states.push(s),failure:()=>assert.fail('unexpected failure')});
  recovery.recover();assert.deepEqual(states,['resyncing']);
  for(let i=0;i<1000;i++)recovery.invalidate('orders');recovery.invalidate('unsubscribed');
  releases.shift()!();await delay(0);
  assert.deepEqual(batches,[['orders','notifications'],['orders']]);assert.deepEqual(states,['resyncing']);
  releases.shift()!();await delay(0);assert.deepEqual(states,['resyncing','live']);
  recovery.recover();assert.deepEqual(states,['resyncing','live','resyncing']);
  assert.deepEqual(batches[2],['orders','notifications']);releases.shift()!();await delay(0);
  assert.equal(states.at(-1),'live');recovery.close();
});
test('closed authority aborts an old read and never becomes live',async()=>{
  const states:string[]=[];let signal:AbortSignal|undefined,release!:()=>void;
  const recovery=new SnapshotRecovery(['orders'],{snapshot:async(_r,s)=>{signal=s;await new Promise<void>(r=>{release=r;});},state:s=>states.push(s),failure:()=>assert.fail('closed context must suppress failures')});
  recovery.recover();recovery.close();assert.equal(signal?.aborted,true);release();await delay(0);assert.deepEqual(states,['resyncing']);
  recovery.recover();recovery.invalidate('orders');assert.deepEqual(states,['resyncing']);
});
test('rejected or hanging reads never report live; failure is once and queue is closed',async()=>{
  for(const hangs of [false,true]){
    const states:string[]=[];let failures=0;
    const recovery=new SnapshotRecovery(['orders'],{timeoutMs:10,snapshot:async()=>{if(hangs)await new Promise(()=>{});else throw new Error('unavailable');},state:s=>states.push(s),failure:()=>{failures++;}});
    recovery.recover();await delay(30);assert.deepEqual(states,['resyncing']);assert.equal(failures,1);
    recovery.invalidate('orders');await delay(0);assert.equal(failures,1);
  }
});
