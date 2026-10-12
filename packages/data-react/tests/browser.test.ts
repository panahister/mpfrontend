import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GlobalRegistrator} from '@happy-dom/global-registrator';

// A DOM and a browser history; React and the libraries are loaded after they exist.
GlobalRegistrator.register({url:'http://localhost/orders'});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {act,createElement,useState}=await import('react');
const {createRoot}=await import('react-dom/client');
const {QueryClient,QueryClientProvider}=await import('@tanstack/react-query');
const {NuqsAdapter}=await import('nuqs/adapters/react');
const {AccessProvider}=await import('@mpfrontend/access-react');
const {QueryScope,useScopedQuery,useScopedMutation,useListUrlState}=await import('../src/index.js');
const {listUrlState,inScope}=await import('../src/shared.js');

const snapshot=(contextRef:string,revision:string,fields:Record<string,{view:boolean;edit:boolean}>={})=>
  ({contextRef,revision,expiresAt:Date.now()+60000,capabilities:{},fields});
const settle=async(ms=0)=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});};
async function mount(element:(snapshot:unknown)=>unknown,first:unknown){
  const host=document.createElement('div');document.body.append(host);
  // No garbage-collection timer: only the scope rule removes data here, and no timer outlives a test.
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{gcTime:Infinity}}});
  const root=createRoot(host);
  const render=async(next:unknown)=>{await act(async()=>{root.render(createElement(NuqsAdapter,null,createElement(QueryClientProvider,{client},
    createElement(AccessProvider,{snapshot:next},createElement(QueryScope,null,element(next) as never)))));});};
  await render(first);
  return {host,client,render,unmount:async()=>{await act(async()=>{root.unmount();});host.remove();client.clear();}};
}

test('a change of scope while a query is pending cancels it, drops its late answer and removes the old scope data',async()=>{
  const reads:Array<{scope:string;signal:AbortSignal;finish:(value:string)=>void}>=[];
  function Orders(){
    const query=useScopedQuery({operation:'orders.list',params:{page:1},read:(_params,signal)=>new Promise<string>(resolve=>{
      reads.push({scope:'pending',signal,finish:resolve});})});
    return createElement('p',null,query.data??'loading');
  }
  const view=await mount(()=>createElement(Orders),snapshot('ctx-1','r1'));
  try{
    assert.equal(reads.length,1);
    await view.render(snapshot('ctx-1','r2'));await settle();
    assert.equal(reads[0]!.signal.aborted,true,'the pending read of the old scope is aborted');
    reads[0]!.finish('old scope data');await settle();
    assert.doesNotMatch(view.host.textContent??'',/old scope data/);
    assert.equal(reads.length,2,'the new scope reads again under its own key');
    reads[1]!.finish('new scope data');await settle();
    assert.equal(view.host.textContent,'new scope data');
    const keys=view.client.getQueryCache().getAll().map(query=>query.queryKey);
    assert.ok(keys.every(key=>inScope(key,{contextRef:'ctx-1',revision:'r2'})),'only the current scope is cached');
    await view.render(snapshot('ctx-2','r1'));await settle();
    reads[2]!.finish('other context data');await settle();
    assert.equal(view.host.textContent,'other context data');
    assert.equal(view.client.getQueryCache().getAll().filter(query=>query.state.data==='new scope data').length,0);
  }finally{await view.unmount();}
});

test('without a valid snapshot no read runs, and data of a closed scope never shows',async()=>{
  let reads=0;
  function Orders(){
    const query=useScopedQuery({operation:'orders.list',params:{},read:async()=>{reads++;return 'data';}});
    return createElement('p',null,query.data??'closed');
  }
  const view=await mount(()=>createElement(Orders),null);
  try{
    await settle();assert.equal(reads,0);assert.equal(view.host.textContent,'closed');
    await view.render(snapshot('ctx-1','r1'));await settle();assert.equal(view.host.textContent,'data');
    await view.render(null);await settle();assert.equal(view.host.textContent,'closed');
    assert.equal(view.client.getQueryCache().getAll().filter(query=>query.state.data==='data').length,0);
  }finally{await view.unmount();}
});

test('a write is never retried after a refusal, and a successful write invalidates the reads it changes',async()=>{
  let writes=0,reads=0,refuse=true;let run!:()=>Promise<unknown>;
  function Orders(){
    const query=useScopedQuery({operation:'orders.list',params:{},read:async()=>{reads++;return 'read '+reads;}});
    const mutation=useScopedMutation({operation:'orders.cancel',invalidates:['orders.list'],
      write:async()=>{writes++;if(refuse)throw new Error('403 FORBIDDEN');return 'done';}});
    run=()=>mutation.mutateAsync(undefined).catch(error=>error);
    return createElement('p',null,query.data??'');
  }
  const view=await mount(()=>createElement(Orders),snapshot('ctx-1','r1'));
  try{
    await settle();assert.equal(view.host.textContent,'read 1');
    await act(async()=>{await run();});await settle(50);
    assert.equal(writes,1,'a refused write is not retried');assert.equal(reads,1);
    refuse=false;await act(async()=>{await run();});await settle();
    assert.equal(writes,2);assert.equal(reads,2,'the changed read is invalidated and read again');
    assert.equal(view.host.textContent,'read 2');
  }finally{await view.unmount();}
});

const urlState=listUrlState({operationId:'listOrders',page:{param:'page',encoding:'number',first:1},size:{param:'size',max:50},
  sort:{param:'sort',fields:['name','cost'],encoding:'signed'},filters:{search:{param:'q',maxLength:20},owner:{param:'owner',maxLength:20,field:'owner'}},
  rows:['items'],total:['total']},{size:10});
type Change=(change:Record<string,unknown>)=>void;
async function list(search:string,canView?:(field:string)=>boolean){
  window.history.replaceState(null,'','/orders'+search);
  let change!:Change;
  function List(){
    const [state,set]=useListUrlState(urlState,canView?{canView}:{});
    change=set as Change;
    const [renders]=useState(()=>({count:0}));renders.count++;
    return createElement('p',null,JSON.stringify(state));
  }
  const view=await mount(()=>createElement(List),snapshot('ctx-1','r1'));
  await settle(80);
  return {...view,state:()=>JSON.parse(view.host.textContent??'{}') as Record<string,unknown>,change:async(value:Record<string,unknown>)=>{await act(async()=>{change(value);});await settle(80);}};
}
const travel=async(direction:'back'|'forward')=>{await act(async()=>{window.history[direction]();});await settle(80);};

test('back and forward move through pages and filters, and a link or a refresh restores them',async()=>{
  const view=await list('');
  try{
    assert.deepEqual(view.state(),{page:1,size:10,filters:{search:'',owner:''}});
    await view.change({page:2});
    assert.equal(window.location.search,'?page=2');
    await view.change({filters:{search:'blue'}});
    assert.equal(window.location.search,'?search=blue','a new filter starts again at the first page');
    await view.change({page:3});
    assert.deepEqual(view.state(),{page:3,size:10,filters:{search:'blue',owner:''}});
    await travel('back');
    assert.deepEqual(view.state(),{page:1,size:10,filters:{search:'blue',owner:''}});
    await travel('back');
    assert.deepEqual(view.state(),{page:2,size:10,filters:{search:'',owner:''}});
    await travel('forward');
    assert.deepEqual(view.state(),{page:1,size:10,filters:{search:'blue',owner:''}});
  }finally{await view.unmount();}
  const refreshed=await list('?page=4&sort=cost.desc&search=red');
  try{
    assert.deepEqual(refreshed.state(),{page:4,size:10,sort:{field:'cost',direction:'desc'},filters:{search:'red',owner:''}});
  }finally{await refreshed.unmount();}
});

test('an invalid value falls back to its default, and a sort or a filter on a field the person may not view leaves the URL on load',async()=>{
  const invalid=await list('?page=-1&size=999&sort=secret');
  try{assert.deepEqual(invalid.state(),{page:1,size:10,filters:{search:'',owner:''}});}finally{await invalid.unmount();}
  const hidden=await list('?page=2&sort=cost.asc&owner=me&search=blue',field=>field==='name');
  try{
    assert.deepEqual(hidden.state(),{page:2,size:10,filters:{search:'blue',owner:''}});
    assert.equal(window.location.search,'?page=2&search=blue');
  }finally{await hidden.unmount();}
});
