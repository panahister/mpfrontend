import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {definePageManifest} from '@mpfrontend/access-core';
import {AccessProvider,AccessGuard,AccessLink,useCapability,useFieldState,useNavigation,useAccessStatus,useAccessScope} from '../src/index.js';

// Server rendering, with no DOM: what the first paint contains.
const snapshot=(overrides:Record<string,unknown>={})=>({contextRef:'ctx-1',revision:'r1',expiresAt:Date.now()+60000,
  capabilities:{'orders.export':true,'orders.cancel':false,'orders.menu':true,'orders.page':true},
  fields:{total:{view:true,edit:true},note:{view:true,edit:false}},...overrides});
const actions=()=>[
  createElement(AccessGuard,{key:'export',capability:'orders.export'},createElement('button',null,'Export orders')),
  createElement(AccessGuard,{key:'cancel',capability:'orders.cancel'},createElement('button',null,'Cancel orders')),
];
const render=(value:unknown,children:ReactNode=actions(),props:Record<string,unknown>={})=>
  renderToStaticMarkup(createElement(AccessProvider,{snapshot:value,...props},children));

test('a snapshot that grants one action and not another renders only the first on the server',()=>{
  const html=render(snapshot());
  assert.match(html,/Export orders/);assert.doesNotMatch(html,/Cancel orders/);
});

test('a missing provider, a missing, malformed or expired snapshot and an unknown id close every kind',()=>{
  function Probe(){
    const field=useFieldState('total');
    return createElement('p',null,[useCapability('orders.export'),useCapability('orders.menu'),field,useAccessStatus()].join(' '));
  }
  assert.equal(renderToStaticMarkup(createElement(Probe)),'<p>false false hidden missing</p>');
  for(const [value,status] of [[undefined,'missing'],[null,'missing'],[{...snapshot(),subject:'person'},'invalid'],
    [snapshot({capabilities:{'orders.export':'yes'}}),'invalid'],[snapshot({expiresAt:Date.now()-1}),'expired']] as const){
    const html=render(value,[...actions(),createElement(Probe,{key:'probe'})]);
    assert.doesNotMatch(html,/Export orders|Cancel orders/);assert.match(html,new RegExp('<p>false false hidden '+status+'</p>'));
  }
  const unknown=render(snapshot(),createElement(AccessGuard,{capability:'orders.unknown'},'Unknown action'));
  assert.equal(unknown,'');
  const known=render(snapshot(),createElement(AccessGuard,{capability:'orders.export'},'Known action'),{keys:{capabilities:['orders.cancel'],fields:[]}});
  assert.equal(known,'','a snapshot with a key the subtree does not know is refused whole');
  const otherContext=render(snapshot(),createElement(AccessGuard,{capability:'orders.export'},'Other context'),{contextRef:'ctx-2'});
  assert.equal(otherContext,'');
});

test('a denied guard renders nothing unless it asks for a fallback or a disabled state',()=>{
  assert.equal(render(snapshot(),createElement(AccessGuard,{capability:'orders.cancel',fallback:createElement('span',null,'Not available')},'Cancel')),'<span>Not available</span>');
  const disabled=(capability:string)=>render(snapshot(),createElement(AccessGuard,{capability,whenDenied:'disabled',
    children:({disabled}:{disabled:boolean})=>createElement('button',{disabled},'Run')}));
  assert.equal(disabled('orders.cancel'),'<button disabled="">Run</button>');
  assert.equal(disabled('orders.export'),'<button>Run</button>');
});

test('a denied link renders no anchor, href or focus target; a granted one renders the router link it is given',()=>{
  const link=(capability:string,extra:Record<string,unknown>={})=>render(snapshot(),createElement(AccessLink,{capability,href:'/orders/export',...extra},'Export'));
  assert.equal(link('orders.export'),'<a href="/orders/export">Export</a>');
  assert.equal(link('orders.cancel'),'');
  assert.equal(link('orders.cancel',{fallback:'Export'}),'Export');
  function RouterLink({href,prefetch,children}:{href:string;prefetch?:boolean;children?:ReactNode}){
    return createElement('a',{href,'data-prefetch':String(prefetch)},children);
  }
  assert.equal(link('orders.export',{as:RouterLink,prefetch:false}),'<a href="/orders/export" data-prefetch="false">Export</a>');
  assert.equal(link('orders.cancel',{as:RouterLink,prefetch:true}),'');
});

test('fields are hidden, disabled or enabled, and an existing busy state stays disabled',()=>{
  function Fields(){return createElement('p',null,[useFieldState('total'),useFieldState('note'),useFieldState('cost'),useFieldState('total',{busy:true})].join(' '));}
  assert.equal(render(snapshot(),createElement(Fields)),'<p>enabled disabled hidden disabled</p>');
});

test('navigation is built from the manifest and the snapshot on the server',()=>{
  const manifest=definePageManifest({pages:[{id:'orders',route:'/orders',menu:'orders.menu',page:'orders.page'},{id:'audit',route:'/audit',menu:'audit.menu',page:'audit.page'}],
    groups:[{id:'admin',menu:'admin.menu',children:['audit']}],navigation:['orders','admin']});
  function Navigation(){return createElement('nav',null,useNavigation(manifest).map(entry=>createElement('span',{key:entry.id},entry.id)));}
  assert.equal(render(snapshot(),createElement(Navigation)),'<nav><span>orders</span></nav>');
  assert.equal(renderToStaticMarkup(createElement(Navigation)),'<nav></nav>');
});

test('the scope is the context reference and revision, and nothing else of the snapshot',()=>{
  function Scope(){return createElement('p',null,JSON.stringify(useAccessScope()??null));}
  assert.equal(render(snapshot(),createElement(Scope)),'<p>'+JSON.stringify({contextRef:'ctx-1',revision:'r1'}).replace(/"/g,'&quot;')+'</p>');
  assert.equal(render(null,createElement(Scope)),'<p>null</p>');
});

test('no source names a role or reads a token claim, and the client entry is a client module',async()=>{
  for(const file of ['index.tsx','server.ts','testing.ts','browser-refusal.ts']){
    const code=(await readFile(new URL('../src/'+file,import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
    assert.doesNotMatch(code,/\broles?\b|\bclaims?\b|\btoken\b/i,file);
  }
  assert.match(await readFile(new URL('../src/index.tsx',import.meta.url),'utf8'),/^'use client';/);
});
