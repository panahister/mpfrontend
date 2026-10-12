import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GlobalRegistrator} from '@happy-dom/global-registrator';

// A DOM for the browser behaviour; React is loaded after it exists.
GlobalRegistrator.register({url:'http://localhost/'});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {act,createElement,useEffect}=await import('react');
const {createRoot}=await import('react-dom/client');
const {AccessProvider,AccessGuard,AccessLink,useAccessCapture,useAccessScope}=await import('../src/index.js');

const snapshot=(revision:string,capabilities:Record<string,boolean>,lifetime=60000)=>({contextRef:'ctx-1',revision,expiresAt:Date.now()+lifetime,capabilities,fields:{}});
const actions=()=>[
  createElement(AccessGuard,{key:'export',capability:'orders.export'},createElement('button',null,'Export orders')),
  createElement(AccessGuard,{key:'cancel',capability:'orders.cancel'},createElement('button',null,'Cancel orders')),
  createElement(AccessLink,{key:'link',capability:'orders.cancel',href:'/orders/cancel'},'Cancel link'),
];
async function mount(props:Record<string,unknown>,children:unknown=actions()){
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  const render=async(next:Record<string,unknown>)=>{await act(async()=>{root.render(createElement(AccessProvider,next as never,children as never));});};
  await render(props);
  return {host,render,unmount:async()=>{await act(async()=>{root.unmount();});host.remove();}};
}
const settle=async(ms=0)=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});};

test('a snapshot that grants one action and not another renders only the first in the browser',async()=>{
  const view=await mount({snapshot:snapshot('r1',{'orders.export':true,'orders.cancel':false})});
  try{
    assert.match(view.host.innerHTML,/Export orders/);assert.doesNotMatch(view.host.innerHTML,/Cancel orders|Cancel link|href/);
    assert.equal(view.host.querySelectorAll('a,[tabindex]').length,0,'no focus target for the denied link');
  }finally{await view.unmount();}
});

test('an expired snapshot closes every entry on an idle screen, with no event',async()=>{
  const view=await mount({snapshot:snapshot('r1',{'orders.export':true},80)});
  try{
    assert.match(view.host.innerHTML,/Export orders/);
    await settle(160);
    assert.doesNotMatch(view.host.innerHTML,/Export orders/);
  }finally{await view.unmount();}
});

test('a new revision replaces the snapshot whole, never a union of old and new',async()=>{
  const view=await mount({snapshot:snapshot('r1',{'orders.export':true})});
  try{
    await view.render({snapshot:snapshot('r2',{'orders.cancel':true})});
    assert.doesNotMatch(view.host.innerHTML,/Export orders/);assert.match(view.host.innerHTML,/Cancel orders/);assert.match(view.host.innerHTML,/href="\/orders\/cancel"/);
  }finally{await view.unmount();}
});

test('a revision change during a pending request aborts it and drops its late answer',async()=>{
  const outcomes:string[]=[];let finish!:(value:string)=>void;
  function Reader(){
    const capture=useAccessCapture(),scope=useAccessScope();
    useEffect(()=>{
      if(scope?.revision!=='r1')return;
      const work=capture();
      new Promise<string>(resolve=>{finish=resolve;}).then(value=>{work.assertCurrent();outcomes.push('published '+value);})
        .catch(error=>outcomes.push(String((error as Error).message)));
      work.signal.addEventListener('abort',()=>outcomes.push('aborted'));
    },[capture,scope]);
    return null;
  }
  const view=await mount({snapshot:snapshot('r1',{'orders.export':true})},createElement(Reader));
  try{
    await view.render({snapshot:snapshot('r2',{'orders.export':true})});
    finish('old protected data');await settle();
    assert.deepEqual(outcomes,['aborted','AUTHORITY_CHANGED']);
  }finally{await view.unmount();}
});

test('the loader is asked again on focus; its answer replaces the snapshot, and a late answer for a replaced one is dropped',async()=>{
  const answers:Array<(value:unknown)=>void>=[],signals:AbortSignal[]=[];
  const reload=(signal:AbortSignal)=>new Promise<unknown>(resolve=>{answers.push(resolve);signals.push(signal);});
  const view=await mount({snapshot:snapshot('r1',{'orders.export':true}),reload});
  try{
    await act(async()=>{window.dispatchEvent(new Event('focus'));});await settle();
    assert.equal(answers.length,1);
    answers[0]!(snapshot('r2',{'orders.cancel':true}));await settle();
    assert.doesNotMatch(view.host.innerHTML,/Export orders/);assert.match(view.host.innerHTML,/Cancel orders/);
    await act(async()=>{window.dispatchEvent(new Event('focus'));});await settle();
    assert.equal(answers.length,2);
    // The server sends a newer snapshot while the reload is pending: the pending answer is dropped.
    await view.render({snapshot:snapshot('r3',{'orders.export':true}),reload});
    answers[1]!(snapshot('r2',{'orders.cancel':true}));await settle();
    assert.match(view.host.innerHTML,/Export orders/);assert.doesNotMatch(view.host.innerHTML,/Cancel orders/);
    await act(async()=>{window.dispatchEvent(new Event('focus'));});await settle();
    answers[2]!({contextRef:'ctx-1',revision:'r4',expiresAt:Date.now()+60000,capabilities:{'orders.export':'yes'},fields:{}});await settle();
    assert.doesNotMatch(view.host.innerHTML,/Export orders|Cancel orders/,'a malformed answer closes every entry');
    await act(async()=>{window.dispatchEvent(new Event('focus'));});await settle();
    assert.equal(signals.length,4);assert.equal(signals[3]!.aborted,false);
  }finally{await view.unmount();}
  assert.equal(signals[3]!.aborted,true,'unmounting aborts a pending reload');
});
