import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GlobalRegistrator} from '@happy-dom/global-registrator';

GlobalRegistrator.register({url:'http://localhost/'});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
// React reports a state update outside act on console.error; these tests leave none.
const actWarnings:string[]=[],report=console.error;
console.error=(...values:unknown[])=>{if(String(values[0]).includes('not wrapped in act'))actWarnings.push(String(values[0]));else report(...values);};
const {act,createElement,useState}=await import('react');
const {createRoot}=await import('react-dom/client');
const {Tree,treeKey,visibleRows,descendantIds}=await import('../src/index.js');
type Node={id:string;label:string;children?:Node[]};

function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
const sample=():Node[]=>freeze([
  {id:'menu',label:'Menu',children:[{id:'menu-file',label:'File'},{id:'menu-edit',label:'Edit',children:[{id:'menu-edit-copy',label:'Copy'}]}]},
  {id:'help',label:'Help'},
]);

async function mount(props:Record<string,unknown>,direction:'ltr'|'rtl'='ltr'){
  const activated:string[]=[];
  function Host(){
    const [expanded,setExpanded]=useState<ReadonlySet<string>>(new Set());
    return createElement(Tree,{label:'Navigation',nodes:sample(),expanded,onExpandedChange:setExpanded,onActivate:(node:{id:string})=>activated.push(node.id),...props});
  }
  const host=document.createElement('div');host.setAttribute('dir',direction);document.body.append(host);
  const root=createRoot(host);
  await act(async()=>{root.render(createElement(Host));});
  const key=async(name:string)=>{await act(async()=>{(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true}));});await act(async()=>{await Promise.resolve();});};
  const focused=()=>document.activeElement?.getAttribute('aria-labelledby')?.split(' ')[0]?document.getElementById(document.activeElement.getAttribute('aria-labelledby')!.split(' ')[0]!)?.textContent:undefined;
  // Focus moves the active row, a state update, so it happens inside act.
  const focusFirst=async()=>{await act(async()=>{host.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')!.focus();});};
  return {host,activated,key,focused,focusFirst,unmount:async()=>{await act(async()=>{root.unmount();});host.remove();}};
}

for(const direction of ['ltr','rtl'] as const){
  test('the keyboard follows the WAI-ARIA tree pattern ('+direction+')',async()=>{
    const [open,close]=direction==='rtl'?['ArrowLeft','ArrowRight']:['ArrowRight','ArrowLeft'];
    const t=await mount({},direction);
    try{
      await t.focusFirst();
      assert.equal(t.focused(),'Menu');
      await t.key(open);
      assert.equal(t.host.querySelector('[role="treeitem"][aria-expanded="true"]')!.getAttribute('aria-level'),'1','the inward arrow expands');
      await t.key(open);assert.equal(t.focused(),'File','then moves to the first child');
      await t.key('ArrowDown');assert.equal(t.focused(),'Edit');
      await t.key(close);assert.equal(t.focused(),'Menu','the outward arrow moves to the parent');
      await t.key(close);assert.equal(t.host.querySelectorAll('[role="treeitem"]').length,2,'then collapses');
      await t.key('End');assert.equal(t.focused(),'Help');
      await t.key('Home');assert.equal(t.focused(),'Menu');
      await t.key('Enter');await t.key(' ');
      assert.deepEqual(t.activated,['menu','menu']);
      assert.equal(t.host.querySelectorAll('[tabindex="0"]').length,1,'one roving tab stop');
    }finally{await t.unmount();}
  });
}

test('items carry their level, size, position, expansion and state in their accessible name',async()=>{
  const t=await mount({states:{'menu':'partial','help':'on'},stateLabels:{on:'Shown',off:'Hidden',partial:'Partly shown'}});
  try{
    const tree=t.host.querySelector('[role="tree"]')!;
    assert.equal(tree.getAttribute('aria-label'),'Navigation');
    const items=[...t.host.querySelectorAll('[role="treeitem"]')];
    assert.deepEqual(items.map(item=>[item.getAttribute('aria-level'),item.getAttribute('aria-setsize'),item.getAttribute('aria-posinset'),item.getAttribute('aria-expanded')]),[['1','2','1','false'],['1','2','2',null]]);
    const name=(item:Element)=>item.getAttribute('aria-labelledby')!.split(' ').map(id=>document.getElementById(id)?.textContent).join(' ');
    assert.deepEqual(items.map(name),['Menu Partly shown','Help Shown']);
  }finally{await t.unmount();}
});

test('a tree table has a treegrid of rows with column cells',async()=>{
  const t=await mount({labelHeader:'Item',columns:[{key:'id',header:'Identifier',cell:(node:{id:string})=>node.id}]});
  try{
    assert.ok(t.host.querySelector('[role="treegrid"][aria-label="Navigation"]'));
    assert.deepEqual([...t.host.querySelectorAll('[role="columnheader"]')].map(cell=>cell.textContent),['Item','Identifier']);
    const row=t.host.querySelector('[role="row"][aria-level="1"]')!;
    assert.equal(row.querySelectorAll('[role="gridcell"]').length,2);
    assert.equal(row.querySelectorAll('[role="gridcell"]')[1]!.textContent,'menu');
  }finally{await t.unmount();}
});

test('ten thousand nodes stay responsive: only the rows in view are rendered, and End reaches the last one',async()=>{
  const nodes:Node[]=freeze(Array.from({length:100},(_,group)=>({id:'g'+group,label:'Group '+group,children:Array.from({length:100},(_,item)=>({id:'g'+group+'-'+item,label:'Item '+group+'-'+item}))})));
  const expanded=new Set(nodes.map(node=>node.id));
  assert.equal(visibleRows(nodes,expanded).length,10100);
  const started=performance.now();
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);
  function Host(){const [open,setOpen]=useState<ReadonlySet<string>>(expanded);return createElement(Tree,{label:'Large',nodes,expanded:open,onExpandedChange:setOpen,rowHeight:40,height:480});}
  try{
    await act(async()=>{root.render(createElement(Host));});
    const rendered=host.querySelectorAll('[role="treeitem"]').length;
    assert.ok(rendered<=30,'rendered '+rendered+' of 10100 rows');
    assert.ok(performance.now()-started<3000,'rendered within three seconds');
    // Focus moves the active row, a state update, so it happens inside act.
    await act(async()=>{host.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')!.focus();});
    await act(async()=>{document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));});
    await act(async()=>{await Promise.resolve();});
    const last=host.querySelector('[role="treeitem"][tabindex="0"]')!;
    assert.equal(document.getElementById(last.getAttribute('aria-labelledby')!.split(' ')[0]!)?.textContent,'Item 99-99');
    assert.equal(last.getAttribute('aria-posinset'),'100');
  }finally{await act(async()=>{root.unmount();});host.remove();}
});

test('the component never changes the data and has no state rule of its own',async()=>{
  const nodes=sample();
  assert.deepEqual(descendantIds(nodes[0]!),['menu-file','menu-edit','menu-edit-copy']);
  const states=freeze({'menu':'on'});
  const t=await mount({states,stateLabels:{on:'Shown'}});
  try{
    await t.focusFirst();
    await t.key('ArrowRight');await t.key('ArrowRight');await t.key('Enter');
    assert.deepEqual(t.activated,['menu-file'],'activation is reported; the consumer decides any change');
    assert.ok(!t.host.textContent?.includes('Hidden'));
    assert.equal(t.host.querySelector('[aria-labelledby$="-state"]')?.getAttribute('aria-labelledby')?.includes('state'),true);
  }finally{await t.unmount();}
  assert.deepEqual(treeKey([],undefined,'ArrowDown','ltr'),undefined);
});

test('no state update of the tree happens outside act',()=>{
  assert.deepEqual(actWarnings,[]);
});
