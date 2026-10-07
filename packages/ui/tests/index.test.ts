import { test } from 'node:test';import assert from 'node:assert/strict';import { createElement,type FormEvent } from 'react';import { renderToStaticMarkup } from 'react-dom/server';import {Button,Card,Field,Select,ResourceTable,ResourceForm} from '../src/index.js';
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
