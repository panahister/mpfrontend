'use client';
import {useEffect,useId,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Button} from './index.js';
import {Dialog} from './dialog.js';

/**
 * The digits of typed or pasted input, at most `length` of them: Arabic-Indic (U+0660 to U+0669) and
 * Extended Arabic-Indic (U+06F0 to U+06F9) digits become ASCII digits, and every other character (spaces,
 * dashes, letters) is dropped. The value is never checked here.
 */
export function codeDigits(input:string,length:number):string{
  let digits='';
  for(const character of input){
    const point=character.codePointAt(0)!;
    if(point>=0x30&&point<=0x39)digits+=character;
    else if(point>=0x660&&point<=0x669)digits+=String(point-0x660);
    else if(point>=0x6f0&&point<=0x6f9)digits+=String(point-0x6f0);
    if(digits.length===length)break;
  }
  return digits;
}

export type OneTimeCodeFieldProps={
  label:string;
  value:string;
  onChange:(value:string)=>void;
  /** Digits in a code; 4 to 10, 6 by default. */
  length?:number;
  helper?:string;
  error?:string;
  disabled?:boolean;
  name?:string;
};

/**
 * A one-time-code field: one input that accepts digits only, of a configured length, with
 * autocomplete="one-time-code" so that the platform can offer a received code, paste of a formatted code,
 * and an error state. It never logs or stores the value.
 */
export function OneTimeCodeField({label,value,onChange,length=6,helper,error,disabled=false,name}:OneTimeCodeFieldProps){
  if(!Number.isSafeInteger(length)||length<4||length>10)throw new Error('INVALID_CODE_LENGTH');
  const id=useId(),description=id+'-description';
  return <label className="mp-field flex max-w-full flex-col gap-[var(--mp-field-gap)]" data-state={disabled?'disabled':error?'error':'default'} htmlFor={id}>
    <span className="mp-field-label text-sm font-medium">{label}</span>
    <input id={id} name={name} className="mp-input mp-code-input h-[var(--mp-control-height)] w-full rounded-[var(--mp-radius-control)] border px-3 tracking-[0.3em]"
      type="text" inputMode="numeric" autoComplete="one-time-code" pattern={'[0-9]{'+length+'}'} maxLength={length*3} dir="ltr"
      spellCheck={false} disabled={disabled} required value={value} aria-invalid={error!==undefined}
      aria-describedby={error||helper?description:undefined} onChange={event=>onChange(codeDigits(event.target.value,length))}/>
    {(helper||error)&&<span id={description} className={error?'mp-field-helper mp-field-error text-xs':'mp-field-helper text-xs'}>{error??helper}</span>}
  </label>;
}

export type ConfirmWithCodeProps={
  open:boolean;
  title:ReactNode;
  description?:ReactNode;
  length?:number;
  labels:Readonly<{code:string;confirm:string;cancel:string;close:string;failed:string;sending?:string}>;
  /**
   * Sends the code to the server through the BFF (a same-origin request with the CSRF token and an
   * idempotency key) and resolves when the server accepted it. The browser never checks the code.
   */
  onConfirm:(code:string,signal:AbortSignal)=>Promise<void>;
  onClose:()=>void;
};

/**
 * Confirms a sensitive action with a code sent to the person. The code lives in component state only: it
 * is cleared on close and on failure, and never written to browser storage, a URL or a log.
 */
export function ConfirmWithCode({open,title,description,length=6,labels,onConfirm,onClose}:ConfirmWithCodeProps){
  const [code,setCode]=useState(''),[status,setStatus]=useState<'idle'|'sending'|'failed'>('idle');
  const active=useRef<AbortController|null>(null);
  useEffect(()=>{if(!open){active.current?.abort();active.current=null;setCode('');setStatus('idle');}},[open]);
  useEffect(()=>()=>active.current?.abort(),[]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(code.length!==length||status==='sending')return;
    const controller=new AbortController();active.current=controller;setStatus('sending');
    try{await onConfirm(code,controller.signal);if(!controller.signal.aborted){setCode('');setStatus('idle');}}
    catch{if(!controller.signal.aborted){setCode('');setStatus('failed');}}
  }
  function close(){active.current?.abort();setCode('');setStatus('idle');onClose();}
  return <Dialog open={open} title={title} description={description} onClose={close} closeLabel={labels.close}>
    <form className="grid gap-4" onSubmit={submit}>
      <OneTimeCodeField label={labels.code} value={code} onChange={value=>{setCode(value);if(status==='failed')setStatus('idle');}} length={length}
        disabled={status==='sending'} {...(status==='failed'?{error:labels.failed}:{})}/>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" tone="ghost" onClick={close}>{labels.cancel}</Button>
        <Button type="submit" disabled={code.length!==length} loading={status==='sending'} {...(labels.sending?{loadingLabel:labels.sending}:{})}>{labels.confirm}</Button>
      </div>
    </form>
  </Dialog>;
}
