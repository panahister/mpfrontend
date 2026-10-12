import {test} from 'node:test';
import assert from 'node:assert/strict';
import {definePageManifest,buildNavigation,checkPageManifest,assertPageManifest,pageKeys,navigationKeys,manifestKeys,type PageAccess} from '../src/index.js';

const manifest=definePageManifest({
  pages:[
    {id:'orders',route:'/orders',menu:'orders.menu',page:'orders.page',elements:[{id:'orders.export'},{id:'orders.cancel',capability:'orders.write'}],fields:['total','note']},
    {id:'order',route:'/orders/[position]',page:'orders.page',fields:['total']},
    {id:'reports',route:'/reports',menu:'reports.menu',page:'reports.page'},
    {id:'audit',route:'/audit',menu:'audit.menu',page:'audit.page'},
  ],
  groups:[{id:'operations',menu:'operations.menu',children:['reports','audit']}],
  navigation:['orders','operations'],
});
const snapshot=(capabilities:Record<string,boolean>):PageAccess=>({contextRef:'c',revision:'1',expiresAt:100,capabilities,fields:{}});

test('navigation shows a page only when its menu and its page are granted',()=>{
  assert.deepEqual(buildNavigation(manifest,snapshot({'orders.menu':true,'orders.page':true}),1),[{kind:'page',id:'orders',route:'/orders'}]);
  assert.deepEqual(buildNavigation(manifest,snapshot({'orders.menu':true}),1),[]);
  assert.deepEqual(buildNavigation(manifest,snapshot({'orders.page':true}),1),[]);
});

test('a parent grants no child and a group with no visible child is pruned',()=>{
  assert.deepEqual(buildNavigation(manifest,snapshot({'operations.menu':true}),1),[]);
  assert.deepEqual(buildNavigation(manifest,snapshot({'operations.menu':true,'audit.menu':true,'audit.page':true}),1),
    [{kind:'group',id:'operations',children:[{kind:'page',id:'audit',route:'/audit'}]}]);
  assert.deepEqual(buildNavigation(manifest,snapshot({'audit.menu':true,'audit.page':true}),1),[],'a closed group hides its granted child');
});

test('a missing or expired snapshot shows no navigation',()=>{
  const all=snapshot(Object.fromEntries(manifestKeys(manifest).capabilities.map(key=>[key,true])));
  assert.equal(buildNavigation(manifest,all,1).length,2);
  assert.deepEqual(buildNavigation(manifest,undefined,1),[]);
  assert.deepEqual(buildNavigation(manifest,all,100),[]);
});

test('the keys of a page, of navigation and of the whole manifest',()=>{
  assert.deepEqual(pageKeys(manifest,'orders'),{capabilities:['orders.page','orders.menu','orders.export','orders.write'],fields:['total','note']});
  assert.deepEqual(pageKeys(manifest,'missing'),{capabilities:[],fields:[]});
  assert.deepEqual(navigationKeys(manifest).capabilities,['operations.menu','orders.menu','orders.page','reports.menu','reports.page','audit.menu','audit.page']);
  assert.deepEqual(manifestKeys(manifest).fields,['total','note']);
});

test('the manifest check fails on a duplicate id, an unregistered id and a route with no entry',()=>{
  assert.deepEqual(checkPageManifest(manifest,{routes:['/orders','/orders/[position]','/reports','/audit'],ids:['orders.export','orders.write','orders.page']}),[]);
  const duplicate=definePageManifest({pages:[{id:'orders',route:'/orders',page:'orders.page',elements:[{id:'orders'}]},{id:'orders',route:'/other',page:'other.page'}]});
  assert.deepEqual(checkPageManifest(duplicate),[{code:'DUPLICATE_ID',id:'orders'},{code:'DUPLICATE_ID',id:'orders'}]);
  assert.deepEqual(checkPageManifest(manifest,{ids:['orders.export','orders.delete']}),[{code:'UNREGISTERED_ID',id:'orders.delete'}]);
  assert.deepEqual(checkPageManifest(manifest,{routes:['/orders','/settings']}),[{code:'UNLISTED_ROUTE',id:'/settings'}]);
  assert.throws(()=>assertPageManifest(manifest,{routes:['/settings'],ids:['x']}),/PAGE_MANIFEST_INVALID UNREGISTERED_ID:x UNLISTED_ROUTE:\/settings/);
  assert.doesNotThrow(()=>assertPageManifest(manifest,{routes:['/orders']}));
});

test('the manifest check reports an unknown child, a page without a menu in navigation and a cycle',()=>{
  const broken=definePageManifest({pages:[{id:'detail',route:'/detail',page:'detail.page'}],
    groups:[{id:'a',menu:'a.menu',children:['b','ghost']},{id:'b',menu:'b.menu',children:['a']}],navigation:['a','detail']});
  assert.deepEqual(checkPageManifest(broken),[{code:'NAVIGATION_CYCLE',id:'a'},{code:'UNKNOWN_CHILD',id:'ghost'},{code:'NO_MENU',id:'detail'}]);
  assert.deepEqual(buildNavigation(broken,snapshot({'a.menu':true,'b.menu':true,'detail.page':true}),1),[]);
});

test('a defined manifest is frozen',()=>{
  assert.ok(Object.isFrozen(manifest)&&Object.isFrozen(manifest.pages)&&Object.isFrozen(manifest.pages[0]!.elements));
});
