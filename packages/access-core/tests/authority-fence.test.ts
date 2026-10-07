import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AuthorityFence} from '../src/index.js';

test('a pending response cannot publish after logout, tenant/role change or account replacement',async()=>{
  for(const next of [null,'other-person','same-person-new-tenant','same-person-revoked-role']){
    const fence=new AuthorityFence();fence.update('original-authority');
    const scope=fence.capture('original-authority');
    let finish!:(value:string)=>void;const response=new Promise<string>(resolve=>{finish=resolve;});
    const published:string[]=[];
    const request=response.then(value=>{scope.assertCurrent();published.push(value);});
    fence.update(next);finish('old protected data');
    await assert.rejects(request,/AUTHORITY_CHANGED/);assert.deepEqual(published,[]);
    assert.equal(scope.signal.aborted,true);
  }
});
test('identical context refresh does not abort work; returning to the same identity never resurrects old work',()=>{
  const fence=new AuthorityFence();assert.throws(()=>fence.capture('a'),/AUTHORITY_CHANGED/);
  fence.update('a');const old=fence.capture('a');fence.update('a');old.assertCurrent();
  assert.equal(old.signal.aborted,false);fence.update('b');fence.update('a');
  assert.throws(old.assertCurrent,/AUTHORITY_CHANGED/);fence.capture('a').assertCurrent();
  assert.throws(()=>fence.capture('b'),/AUTHORITY_CHANGED/);
});
