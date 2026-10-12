import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GlobalRegistrator} from '@happy-dom/global-registrator';

// A DOM for the controls of the table; React is loaded after it exists.
GlobalRegistrator.register({url:'http://localhost/'});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {act,createElement}=await import('react');
const {createRoot}=await import('react-dom/client');
const {renderToStaticMarkup}=await import('react-dom/server');
const {ResourceTable}=await import('../src/index.js');
const {accessReader}=await import('@mpfrontend/access-core');

const fields=[{key:'name',type:'string',required:true,nullable:false,editable:false},{key:'cost',type:'number',required:true,nullable:false,editable:false}];
const rows=[{name:'beta',cost:2},{name:'alpha',cost:3},{name:'gamma',cost:1},{name:'alphabet',cost:4}];
const text={pagination:'Pages',previous:'Previous',next:'Next',page:(page:number,count:number|undefined)=>'Page '+page+' of '+(count??'?'),size:'Rows',apply:'Apply',filters:'Filters'};
type Events={page:number[];size:number[];sort:unknown[];filters:unknown[]};
function control(overrides:Record<string,unknown>,events:Events={page:[],size:[],sort:[],filters:[]}){
  return {mode:'client',page:1,size:10,text,sortable:['name','cost'],filterable:['name'],sizes:[2,10],
    onPageChange:(value:number)=>events.page.push(value),onSizeChange:(value:number)=>events.size.push(value),
    onSortChange:(value:unknown)=>events.sort.push(value),onFiltersChange:(value:unknown)=>events.filters.push(value),...overrides};
}
const cells=(html:string)=>[...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(match=>match[1]);
const render=(props:Record<string,unknown>)=>renderToStaticMarkup(createElement(ResourceTable,{fields,rows,caption:'Orders',format:String,...props} as never));

test('server mode shows the rows as the server returned them: no local sort, filter or paging',()=>{
  const html=render({control:control({mode:'server',size:2,total:9,sort:{field:'name',direction:'asc'},filters:{name:'zzz'}})});
  assert.deepEqual(cells(html),['beta','2','alpha','3','gamma','1','alphabet','4']);
  assert.match(html,/Page 1 of 5/);
});

test('client mode filters, sorts and pages the rows it is given, and the mode is never switched by the data',()=>{
  const html=render({control:control({mode:'client',size:2,page:1,total:99,sort:{field:'cost',direction:'desc'},filters:{name:'ALPHA'}})});
  assert.deepEqual(cells(html),['alphabet','4','alpha','3']);assert.match(html,/Page 1 of 1/);
  assert.deepEqual(cells(render({control:control({mode:'client',size:2,page:2,sort:{field:'name',direction:'asc'}})})),['beta','2','gamma','1']);
  assert.deepEqual(cells(render({control:control({mode:'server',size:2,page:2})})).length,8,'server mode never pages rows itself');
});

test('a sort or a filter on a column the person may not view is ignored, and its control is not shown',()=>{
  const access=accessReader({contextRef:'c',revision:'1',expiresAt:Date.now()+60000,capabilities:{},fields:{name:{view:true,edit:false}}});
  const html=render({access,control:control({mode:'client',sort:{field:'cost',direction:'asc'},filters:{cost:'1'},filterable:['name','cost']})});
  assert.deepEqual(cells(html),['beta','alpha','gamma','alphabet']);
  assert.doesNotMatch(html,/name="cost"|>cost</);assert.match(html,/name="name"/);
});

test('without control the table renders exactly as before',()=>{
  assert.equal(render({}),'<div class="mp-table-wrap overflow-auto"><table class="w-full border-collapse"><caption>Orders</caption><thead><tr><th class="border-b p-3 text-start" scope="col">name</th><th class="border-b p-3 text-start" scope="col">cost</th></tr></thead><tbody><tr><td class="border-b p-3 text-start">beta</td><td class="border-b p-3 text-start">2</td></tr><tr><td class="border-b p-3 text-start">alpha</td><td class="border-b p-3 text-start">3</td></tr><tr><td class="border-b p-3 text-start">gamma</td><td class="border-b p-3 text-start">1</td></tr><tr><td class="border-b p-3 text-start">alphabet</td><td class="border-b p-3 text-start">4</td></tr></tbody></table></div>');
});

test('the controls emit page, size, sort and filter changes and leave the values to their owner',async()=>{
  const events:Events={page:[],size:[],sort:[],filters:[]};
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  const mount=async(overrides:Record<string,unknown>)=>{await act(async()=>{root.render(createElement(ResourceTable,{fields,rows,caption:'Orders',format:String,control:control(overrides,events)} as never));});};
  try{
    await mount({mode:'server',page:1,size:2,total:4,sort:{field:'name',direction:'asc'},filters:{name:'al'}});
    const buttons=()=>[...host.querySelectorAll('button')];
    const named=(label:string)=>buttons().find(button=>button.textContent===label)!;
    assert.equal(host.querySelector('th[aria-sort="ascending"]')?.textContent,'name');
    assert.equal(host.querySelector('th[aria-sort="none"]')?.textContent,'cost');
    assert.equal(named('Previous').disabled,true);
    await act(async()=>{named('name').click();});await act(async()=>{named('cost').click();});await act(async()=>{named('Next').click();});
    assert.deepEqual(events.sort,[{field:'name',direction:'desc'},{field:'cost',direction:'asc'}]);assert.deepEqual(events.page,[2]);
    const select=host.querySelector('select')!;
    await act(async()=>{select.value='10';select.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.deepEqual(events.size,[10]);
    const input=host.querySelector<HTMLInputElement>('input[name="name"]')!;assert.equal(input.value,'al');
    input.value='gam';
    await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    assert.deepEqual(events.filters,[{name:'gam'}]);
    await mount({mode:'server',page:2,size:2,total:4,sort:{field:'name',direction:'desc'}});
    assert.equal(named('Next').disabled,true);assert.equal(named('Previous').disabled,false);
    await act(async()=>{named('name').click();});
    assert.deepEqual(events.sort.at(-1),undefined,'a descending sort clears on the next click');
    await mount({mode:'server',page:1,size:2,total:undefined,hasMore:true});
    assert.equal(named('Next').disabled,false);assert.match(host.textContent??'',/Page 1 of \?/);
  }finally{await act(async()=>{root.unmount();});host.remove();}
});
