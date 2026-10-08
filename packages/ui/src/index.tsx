'use client';
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, type Key } from 'react';
import {buttonState,fieldState,isControlUnavailable} from '@mpfrontend/primitives';

export type DisplayField = Readonly<{key:string;type:string;required:boolean;editable:boolean;nullable:boolean}>;
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?:'primary'|'secondary'|'ghost'|'danger';
  loading?:boolean;
  loadingLabel?:ReactNode;
  restricted?:boolean;
  leadingIcon?:ReactNode;
  trailingIcon?:ReactNode;
};
export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {label:string;helper?:string;error?:string};
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {label:string;icon?:ReactNode};

export function Button({tone='primary',loading=false,loadingLabel,restricted=false,leadingIcon,trailingIcon,children,disabled,...props}:ButtonProps) {
  const state=buttonState({disabled:disabled??false,loading,restricted});
  return <button {...props} disabled={isControlUnavailable(state)} aria-busy={state==='loading'||undefined} aria-disabled={state==='restricted'||undefined} data-state={state} data-tone={tone} className={['mp-button','inline-flex h-[var(--mp-control-height)] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--mp-radius-control)] border-0 px-[var(--mp-control-padding)]',props.className].filter(Boolean).join(' ')}>
    {loading?<span className="mp-button-spinner" aria-hidden="true"/>:leadingIcon}
    <span>{loading?(loadingLabel??children):children}</span>
    {!loading&&trailingIcon}
  </button>;
}
export function Field({label,helper,error,...props}:FieldProps) {
  const generated=useId(),id=props.id ?? generated,description=id+'-description';
  const state=fieldState({disabled:props.disabled??false,readOnly:props.readOnly??false,invalid:!!error});
  return <label className="mp-field flex max-w-full flex-col gap-[var(--mp-field-gap)]" data-state={state} htmlFor={id}><span className="mp-field-label text-sm font-medium">{label}</span><input {...props} id={id} className={['mp-input','h-[var(--mp-control-height)] w-full rounded-[var(--mp-radius-control)] border px-3',props.className].filter(Boolean).join(' ')} aria-invalid={!!error} aria-describedby={error||helper?description:props['aria-describedby']}/>{(helper||error)&&<span id={description} className={error?'mp-field-helper mp-field-error text-xs':'mp-field-helper text-xs'}>{error ?? helper}</span>}</label>;
}
export function Select({label,children,icon,...props}:SelectProps) {
  const generated=useId(),id=props.id ?? generated;
  const state=fieldState({disabled:props.disabled??false});
  return <label className="mp-field flex max-w-full flex-col gap-[var(--mp-field-gap)]" data-state={state} htmlFor={id}><span className="mp-field-label text-sm font-medium">{label}</span><span className="mp-select-wrap relative w-full" data-custom-icon={icon ? 'true' : undefined}><select {...props} id={id} className={['mp-select','h-[var(--mp-control-height)] w-full rounded-[var(--mp-radius-control)] border px-3',props.className].filter(Boolean).join(' ')}>{children}</select>{icon && <span className="mp-select-icon pointer-events-none absolute end-3 top-1/2 -translate-y-1/2" aria-hidden="true">{icon}</span>}</span></label>;
}
export function Card({children}:{children:ReactNode}) { return <section className="mp-card rounded-[var(--mp-radius-surface)] border p-6">{children}</section>; }
export function ResourceTable({fields,rows,caption,format,labels={},detail,rowKey}:{fields:readonly DisplayField[];rows:readonly Record<string,unknown>[];caption:string;format:(value:unknown)=>string;labels?:Readonly<Record<string,string>>;detail?:(row:Record<string,unknown>)=>ReactNode;rowKey?:(row:Record<string,unknown>,index:number)=>Key}) {
  return <div className="mp-table-wrap overflow-auto"><table className="w-full border-collapse"><caption>{caption}</caption><thead><tr>{fields.map(field=><th className="border-b p-3 text-start" scope="col" key={field.key}>{labels[field.key] ?? field.key}</th>)}{detail && <th className="border-b p-3 text-start" scope="col">{labels.detail ?? 'Details'}</th>}</tr></thead><tbody>{rows.map((row,index)=><tr key={rowKey ? rowKey(row,index) : index}>{fields.map(field=><td className="border-b p-3 text-start" key={field.key}>{format(row[field.key])}</td>)}{detail && <td className="border-b p-3 text-start">{detail(row)}</td>}</tr>)}</tbody></table></div>;
}
export function ResourceForm({fields,values,onChange,onSubmit,labels={},saveLabel,disabled=false}:{fields:readonly DisplayField[];values:Readonly<Record<string,unknown>>;onChange:(key:string,value:unknown)=>void;onSubmit:()=>void;labels?:Readonly<Record<string,string>>;saveLabel:string;disabled?:boolean}) {
  const editable=fields.filter(field=>field.editable);
  if(editable.some(field=>!['string','boolean','number','integer'].includes(field.type)))throw new Error('UNSUPPORTED_FORM_FIELD');
  const unavailable=disabled||editable.length===0;
  return <form className="mp-form grid gap-4" onSubmit={event=>{event.preventDefault();if(!unavailable)onSubmit();}}>{editable.map(field=><Field key={field.key} label={labels[field.key] ?? field.key} name={field.key} required={field.required&&field.type!=='boolean'} disabled={disabled} type={field.type==='boolean'?'checkbox':field.type==='number'||field.type==='integer'?'number':'text'} step={field.type==='number'?'any':field.type==='integer'?1:undefined} checked={field.type==='boolean'?values[field.key]===true:undefined} value={field.type==='boolean'?undefined:String(values[field.key] ?? '')} onChange={event=>onChange(field.key,field.type==='boolean'?event.target.checked:field.type==='number'||field.type==='integer'?event.target.valueAsNumber:event.target.value)} />)}<Button disabled={unavailable} type="submit" tone="secondary">{saveLabel}</Button></form>;
}
export {Dialog,nextFocus,type DialogProps} from './dialog.js';
export {OneTimeCodeField,ConfirmWithCode,codeDigits,type OneTimeCodeFieldProps,type ConfirmWithCodeProps} from './one-time-code.js';
export {Tree,visibleRows,descendantIds,treeKey,type TreeNode,type TreeRow,type TreeColumn,type TreeMove,type TreeProps} from './tree.js';
