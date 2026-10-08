import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GlobalRegistrator} from '@happy-dom/global-registrator';

// A DOM for keyboard and focus behaviour; React is loaded after it exists.
GlobalRegistrator.register({url:'http://localhost/'});
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const {act,createElement,useState}=await import('react');
const {createRoot}=await import('react-dom/client');
const {Dialog,OneTimeCodeField,ConfirmWithCode,codeDigits,nextFocus}=await import('../src/index.js');

async function mount(element:ReturnType<typeof createElement>,direction:'ltr'|'rtl'='ltr'){
  const host=document.createElement('div');host.setAttribute('dir',direction);document.body.append(host);
  const root=createRoot(host);
  await act(async()=>{root.render(element);});
  return {host,unmount:async()=>{await act(async()=>{root.unmount();});host.remove();}};
}
const key=async(name:string,shift=false)=>{
  await act(async()=>{(document.activeElement??document.body).dispatchEvent(new KeyboardEvent('keydown',{key:name,shiftKey:shift,bubbles:true,cancelable:true}));});
};
const type=async(input:HTMLInputElement,value:string)=>{
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
};

function DialogFixture({onClose}:{onClose?:()=>void}){
  const [open,setOpen]=useState(false);
  return createElement('div',null,
    createElement('button',{id:'opener',onClick:()=>setOpen(true)},'open'),
    createElement(Dialog,{open,title:'Title',description:'Description',closeLabel:'Close',onClose:()=>{onClose?.();setOpen(false);}},
      createElement('input',{id:'first-field'}),createElement('button',{id:'last-action'},'Act')));
}

for(const direction of ['ltr','rtl'] as const){
  test('the dialog is modal and named, keeps Tab inside, closes on Escape and returns focus ('+direction+')',async()=>{
    let closed=0;
    const {host,unmount}=await mount(createElement(DialogFixture,{onClose:()=>{closed++;}}),direction);
    try{
      const opener=host.querySelector<HTMLButtonElement>('#opener')!;opener.focus();
      await act(async()=>{opener.click();});
      const dialog=host.querySelector('dialog')!;
      assert.equal(dialog.getAttribute('aria-modal'),'true');
      assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent,'Title');
      assert.equal(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent,'Description');
      assert.ok(dialog.contains(document.activeElement),'focus moves into the dialog');
      const close=dialog.querySelector('button[aria-label="Close"]')!;
      assert.equal(document.activeElement,close,'the first control receives focus');
      await key('Tab',true);assert.equal(document.activeElement?.id,'last-action','Shift+Tab wraps to the last control');
      await key('Tab');assert.equal(document.activeElement,close,'Tab wraps to the first control');
      await key('Tab');assert.equal(document.activeElement?.id,'first-field');
      await key('Escape');
      assert.equal(closed,1);
      assert.equal(dialog.hasAttribute('open'),false);
      assert.equal(document.activeElement,opener,'focus returns to the opener');
      assert.doesNotMatch(host.innerHTML,/\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/,'logical properties only');
    }finally{await unmount();}
  });
}

test('focus wraps at both ends of the trap',()=>{
  assert.equal(nextFocus(['a','b','c'],'c',false),'a');
  assert.equal(nextFocus(['a','b','c'],'a',true),'c');
  assert.equal(nextFocus(['a','b','c'],null,false),'a');
  assert.equal(nextFocus([],null,false),undefined);
});

test('the code field takes digits only, of its length, from typing or a formatted paste, and never logs',async()=>{
  const logs:unknown[]=[];const original=console.log;console.log=(...values:unknown[])=>{logs.push(values);};
  try{
    assert.equal(codeDigits('12a3-45 6',6),'123456');
    const persian=String.fromCodePoint(...[1,2,3,4,5,6].map(d=>0x6f0+d)),arabic=String.fromCodePoint(...[9,8,7,6].map(d=>0x660+d));
    assert.equal(codeDigits(persian,6),'123456');assert.equal(codeDigits(arabic,4),'9876');
    assert.equal(codeDigits('123456789',6),'123456');
    let value='';
    function Field(){const [code,setCode]=useState('');value=code;return createElement(OneTimeCodeField,{label:'Code',value:code,onChange:setCode,length:6,error:code==='000000'?'Wrong':undefined});}
    const {host,unmount}=await mount(createElement(Field));
    try{
      const input=host.querySelector('input')!;
      assert.equal(input.getAttribute('autocomplete'),'one-time-code');
      assert.equal(input.getAttribute('inputmode'),'numeric');
      assert.equal(input.getAttribute('aria-invalid'),'false');
      await type(input,'98-76 54 3');assert.equal(value,'987654');
      await type(input,'000000');
      assert.equal(input.getAttribute('aria-invalid'),'true');
      assert.equal(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent,'Wrong');
      assert.equal(host.querySelector('label')?.textContent?.startsWith('Code'),true,'the label names the field');
    }finally{await unmount();}
    assert.deepEqual(logs,[]);
    assert.throws(()=>OneTimeCodeField({label:'Code',value:'',onChange:()=>{},length:3}),/INVALID_CODE_LENGTH/);
  }finally{console.log=original;}
});

test('confirm with code sends the code, clears it on failure and on close, and never stores it',async()=>{
  const stored:string[]=[];
  const setItem=Storage.prototype.setItem;Storage.prototype.setItem=function(name:string,item:string){stored.push(name+'='+item);setItem.call(this,name,item);};
  const cookie=document.cookie;
  let attempts:string[]=[],fail=true;
  function Fixture(){
    const [open,setOpen]=useState(true);
    return createElement(ConfirmWithCode,{open,title:'Confirm',length:6,labels:{code:'Code',confirm:'Confirm',cancel:'Cancel',close:'Close',failed:'Not accepted'},
      onClose:()=>setOpen(false),onConfirm:async(code:string)=>{attempts.push(code);if(fail)throw new Error('rejected');}});
  }
  const {host,unmount}=await mount(createElement(Fixture));
  try{
    const input=()=>host.querySelector<HTMLInputElement>('dialog input')!;
    const submit=async()=>{await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});};
    await type(input(),'123456');await submit();
    assert.deepEqual(attempts,['123456']);
    assert.equal(input().value,'','a failed code is cleared');
    assert.match(host.textContent??'',/Not accepted/);
    fail=false;attempts=[];
    await type(input(),'654321');await submit();
    assert.deepEqual(attempts,['654321']);
    await type(input(),'111111');
    await act(async()=>{host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();});
    assert.equal(host.querySelector('dialog')?.hasAttribute('open'),false);
    assert.equal(host.querySelector('dialog input'),null,'nothing of the code remains rendered');
    assert.deepEqual(stored,[]);assert.equal(document.cookie,cookie);assert.equal(location.href,'http://localhost/');
  }finally{await unmount();Storage.prototype.setItem=setItem;}
});
