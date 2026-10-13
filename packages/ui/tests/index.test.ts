import { test } from 'node:test';import assert from 'node:assert/strict';import { createElement,type FormEvent } from 'react';import { renderToStaticMarkup } from 'react-dom/server';import {Button,Card,Field,Select,ResourceTable,ResourceForm} from '../src/index.js';import {accessReader} from '@mpfrontend/access-core';
test('shared table uses semantic headers and displays the supplied projection only',()=>{const html=renderToStaticMarkup(createElement(ResourceTable,{fields:[{key:'name',type:'string',required:true,nullable:false,editable:false}],rows:[{name:'Visible'}],caption:'Catalog',format:String}));assert.match(html,/scope="col"/);assert.match(html,/Visible/);assert.match(html,/<caption>Catalog/);});
test('button exposes semantic loading state and preserves the supplied localized action',()=>{const html=renderToStaticMarkup(createElement(Button,{loading:true,tone:'danger'},'Delete'));assert.match(html,/aria-busy="true"/);assert.match(html,/disabled/);assert.match(html,/data-tone="danger"/);assert.match(html,/Delete/);assert.doesNotMatch(html,/Loading/);});
test('restricted button is unavailable without pretending to be loading',()=>{const html=renderToStaticMarkup(createElement(Button,{restricted:true},'Approve'));assert.match(html,/data-state="restricted"/);assert.match(html,/aria-disabled="true"/);assert.doesNotMatch(html,/aria-busy/);});
test('a product can supply an explicit localized loading label',()=>{const html=renderToStaticMarkup(createElement(Button,{loading:true,loadingLabel:'Saving changes'},'Save'));assert.match(html,/Saving changes/);assert.doesNotMatch(html,/>Save</);});
test('component markup carries the structural Tailwind contract, not semantic classes alone',()=>{
  const card=renderToStaticMarkup(createElement(Card,null,'Content'));
  assert.match(card,/class="mp-card [^"]*\bp-6\b/);
  const field=renderToStaticMarkup(createElement(Field,{label:'Name'}));
  assert.match(field,/class="mp-field flex [^"]*flex-col/);
  const select=renderToStaticMarkup(createElement(Select,{label:'Category',icon:'v'}));
  assert.match(select,/mp-select-wrap relative w-full/);
  assert.match(select,/pointer-events-none absolute end-3/);
  const button=renderToStaticMarkup(createElement(Button,null,'Save'));
  assert.match(button,/mp-button inline-flex/);
});
const formBase={values:{},onChange:()=>{},onSubmit:()=>{},saveLabel:'Save'};
test('the default scalar form refuses nested and collection editors instead of stringifying structured data',()=>{
  for(const type of ['object','array'])assert.throws(()=>renderToStaticMarkup(createElement(ResourceForm,{...formBase,fields:[{key:'nested',type,required:true,nullable:false,editable:true}]})),/UNSUPPORTED_FORM_FIELD/);
});
test('a response-only or disabled form cannot invoke its submit callback',()=>{
  for(const props of [{fields:[{key:'name',type:'string',required:true,nullable:false,editable:false}]},{fields:[{key:'name',type:'string',required:true,nullable:false,editable:true}],disabled:true}]){
    let submitted=0;
    const element=ResourceForm({...formBase,...props,onSubmit:()=>{submitted++;}});
    const onSubmit=(element.props as {onSubmit:(event:FormEvent<HTMLFormElement>)=>void}).onSubmit;
    onSubmit({preventDefault(){}} as FormEvent<HTMLFormElement>);assert.equal(submitted,0);
    assert.match(renderToStaticMarkup(element),/<button[^>]*disabled/);
  }
});
test('number form inputs allow fractional values without treating them as integers',()=>{
  const html=renderToStaticMarkup(createElement(ResourceForm,{...formBase,fields:[{key:'amount',type:'number',required:true,nullable:false,editable:true}]}));
  assert.match(html,/step="any"/);
});
test('a required JSON boolean permits false instead of demanding a checked consent checkbox',()=>{
  const html=renderToStaticMarkup(createElement(ResourceForm,{...formBase,values:{available:false},fields:[{key:'available',type:'boolean',required:true,nullable:false,editable:true}]}));
  assert.match(html,/type="checkbox"/);assert.doesNotMatch(html,/<input[^>]*required/);assert.doesNotMatch(html,/<input[^>]*checked/);
});
const reader=(fields:Record<string,{view:boolean;edit:boolean}>)=>accessReader({contextRef:'c',revision:'1',expiresAt:Date.now()+60000,capabilities:{},fields});
const accessFields=[{key:'name',type:'string',required:true,nullable:false,editable:true},{key:'note',type:'string',required:true,nullable:false,editable:true},{key:'cost',type:'number',required:true,nullable:false,editable:true}];
const inputTag=(html:string,name:string)=>html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0]??'';
const submitOf=(element:ReturnType<typeof ResourceForm>)=>()=>(element.props as {onSubmit:(event:FormEvent<HTMLFormElement>)=>void}).onSubmit({preventDefault(){}} as FormEvent<HTMLFormElement>);
test('a table with field access removes a column the person may not view, with its header and values',()=>{
  const html=renderToStaticMarkup(createElement(ResourceTable,{fields:accessFields,rows:[{name:'Visible',note:'Shown note',cost:'Secret cost'}],caption:'Orders',format:String,labels:{cost:'Cost header'},access:reader({name:{view:true,edit:false},note:{view:true,edit:false}})}));
  assert.match(html,/Visible/);assert.match(html,/Shown note/);assert.doesNotMatch(html,/Secret cost|Cost header|>cost</);
  assert.equal(html.match(/<th[ >]/g)?.length,2);
  const closed=renderToStaticMarkup(createElement(ResourceTable,{fields:accessFields,rows:[{name:'Visible'}],caption:'Orders',format:String,access:accessReader(undefined)}));
  assert.doesNotMatch(closed,/Visible|<th[ >]/);
});
test('a form with field access leaves out a hidden field with its label, helper and error, and disables a field it may not edit',()=>{
  const html=renderToStaticMarkup(createElement(ResourceForm,{...formBase,fields:accessFields,values:{name:'a',note:'n',cost:5},original:{},
    labels:{name:'Name label',note:'Note label',cost:'Cost label'},helpers:{cost:'Cost helper',note:'Note helper'},errors:{cost:'Cost error'},
    access:reader({name:{view:true,edit:true},note:{view:true,edit:false}})}));
  assert.doesNotMatch(html,/Cost label|Cost helper|Cost error|name="cost"/);
  assert.match(html,/Note helper/);
  assert.match(inputTag(html,'note'),/ disabled=""/);assert.doesNotMatch(inputTag(html,'name'),/ disabled/);
  assert.match(inputTag(html,'name'),/ required=""/);
});
test('a save sends only the changed fields the person may edit; a hidden field never leaves',()=>{
  const patches:unknown[]=[];
  const submit=submitOf(ResourceForm({...formBase,fields:accessFields,original:{name:'old',note:'n'},values:{name:'new',note:'n',cost:99},
    access:reader({name:{view:true,edit:true},note:{view:true,edit:false}}),onSubmit:(patch?:Record<string,unknown>)=>{patches.push(patch);}}));
  submit();assert.deepEqual(patches,[{name:'new'}]);
  const tampered=submitOf(ResourceForm({...formBase,fields:accessFields,original:{name:'old',note:'n'},values:{name:'old',note:'changed'},
    access:reader({name:{view:true,edit:true},note:{view:true,edit:false}}),onSubmit:()=>{patches.push('sent');}}));
  assert.throws(tampered,/FORBIDDEN_FIELD/);assert.equal(patches.length,1);
});
test('a form with access must say what the person started from: without `original` it refuses, with an empty one it sends what was entered',()=>{
  const patches:unknown[]=[];
  const access=reader({name:{view:true,edit:true},note:{view:true,edit:true}});
  // Without `original` every shown field would count as changed and be sent: the form refuses, for callers the types do not reach.
  assert.throws(()=>ResourceForm({...formBase,fields:accessFields,values:{name:'a',note:'n'},access} as never),/RESOURCE_FORM_ORIGINAL_REQUIRED/);
  assert.throws(()=>renderToStaticMarkup(createElement(ResourceForm,{...formBase,fields:accessFields,values:{name:'a'},access} as never)),/RESOURCE_FORM_ORIGINAL_REQUIRED/);
  // A new record starts from nothing: an explicit empty original sends the fields that were filled in.
  submitOf(ResourceForm({...formBase,fields:accessFields,original:{},values:{name:'a',note:'n'},access,onSubmit:(patch?:Record<string,unknown>)=>{patches.push(patch);}}))();
  assert.deepEqual(patches,[{name:'a',note:'n'}]);
  // Without access nothing is asked.
  assert.doesNotThrow(()=>ResourceForm({...formBase,fields:accessFields,values:{}}));
});
test('a closed reader or an existing disabled state keeps the form unavailable; without access nothing changes',()=>{
  let calls=0;
  const closed=ResourceForm({...formBase,fields:accessFields,original:{},access:accessReader(undefined),onSubmit:()=>{calls++;}});
  submitOf(closed)();assert.equal(calls,0);assert.doesNotMatch(renderToStaticMarkup(closed),/<input/);assert.match(renderToStaticMarkup(closed),/<button[^>]*disabled/);
  const busy=ResourceForm({...formBase,fields:accessFields,original:{},disabled:true,access:reader({name:{view:true,edit:true}}),onSubmit:()=>{calls++;}});
  submitOf(busy)();assert.equal(calls,0);assert.match(inputTag(renderToStaticMarkup(busy),'name'),/ disabled=""/);
  const readOnly=ResourceForm({...formBase,fields:accessFields,original:{},access:reader({name:{view:true,edit:false}}),onSubmit:()=>{calls++;}});
  submitOf(readOnly)();assert.equal(calls,0);
  const received:unknown[]=[];
  const plain=ResourceForm({...formBase,fields:accessFields,values:{name:'a',note:'b',cost:1},onSubmit:(...args:unknown[])=>{received.push(args.length);}});
  submitOf(plain)();assert.deepEqual(received,[0]);assert.match(renderToStaticMarkup(plain),/name="cost"/);
});
