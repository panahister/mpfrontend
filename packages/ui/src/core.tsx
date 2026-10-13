'use client';
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type ReactNode, type Key } from 'react';
import {buttonState,fieldState,isControlUnavailable} from '@mpfrontend/primitives/internal';
import type {AccessReader} from '@mpfrontend/access-core';

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
export type TableSort=Readonly<{field:string;direction:'asc'|'desc'}>;
/** The visible text of the table's controls, from the consumer's catalog. */
export type TableText=Readonly<{
  pagination:string;previous:string;next:string;
  /** The current page and the page count, when the count is known. */
  page:(page:number,count:number|undefined)=>string;
  size?:string;apply?:string;filters?:string;
}>;
/**
 * The controlled state of a table and its change events. The mode is declared, never inferred: in `client` mode the
 * table filters, sorts and pages the rows it is given; in `server` mode it shows them as the server returned them and
 * never sorts, filters or pages them itself.
 */
export type TableControl=Readonly<{
  mode:'client'|'server';
  page:number;size:number;sort?:TableSort|undefined;filters?:Readonly<Record<string,string>>;
  /** The total number of rows the server reports (server mode). */
  total?:number|undefined;
  /** Whether a next page exists, when the server reports no total (server mode). */
  hasMore?:boolean;
  sortable?:readonly string[];filterable?:readonly string[];sizes?:readonly number[];
  onPageChange:(page:number)=>void;
  onSizeChange?:(size:number)=>void;
  onSortChange?:(sort:TableSort|undefined)=>void;
  onFiltersChange?:(filters:Readonly<Record<string,string>>)=>void;
  text:TableText;
}>;
function compareValues(a:unknown,b:unknown):number{
  if(a===b)return 0;
  if(a===null||a===undefined)return 1;
  if(b===null||b===undefined)return -1;
  if(typeof a==='number'&&typeof b==='number')return a-b;
  if(typeof a==='boolean'&&typeof b==='boolean')return a===b?0:a?1:-1;
  return String(a).localeCompare(String(b));
}
const nextSort=(sort:TableSort|undefined,field:string):TableSort|undefined=>
  sort?.field!==field?{field,direction:'asc'}:sort.direction==='asc'?{field,direction:'desc'}:undefined;
/**
 * With `access`, a column whose field may not be viewed is removed with its header. Without it, every field shows.
 * With `control`, the table has sortable headers, filters and paging bound to the controlled values; a sort or a
 * filter on a column the person may not view is ignored. Without it, the table renders the rows as before.
 */
export function ResourceTable({fields,rows,caption,format,labels={},detail,rowKey,access,control}:{fields:readonly DisplayField[];rows:readonly Record<string,unknown>[];caption:string;format:(value:unknown)=>string;labels?:Readonly<Record<string,string>>;detail?:(row:Record<string,unknown>)=>ReactNode;rowKey?:(row:Record<string,unknown>,index:number)=>Key;access?:AccessReader;control?:TableControl}) {
  const columns=access?fields.filter(field=>access.field(field.key).view):fields;
  const visible=new Set(columns.map(field=>field.key)),hiddenField=(key:string)=>fields.some(field=>field.key===key)&&!visible.has(key);
  let shown=rows,total:number|undefined;
  if(control?.mode==='client'){
    const filters=Object.entries(control.filters??{}).filter(([key,value])=>value!==''&&visible.has(key));
    let selected=rows.filter(row=>filters.every(([key,value])=>format(row[key]).toLocaleLowerCase().includes(value.toLocaleLowerCase())));
    const sort=control.sort&&visible.has(control.sort.field)?control.sort:undefined;
    if(sort)selected=[...selected].sort((a,b)=>compareValues(a[sort.field],b[sort.field])*(sort.direction==='asc'?1:-1));
    total=selected.length;
    shown=selected.slice((control.page-1)*control.size,control.page*control.size);
  }else if(control)total=control.total;
  const count=control&&total!==undefined?Math.max(1,Math.ceil(total/control.size)):undefined;
  const header=(field:DisplayField)=>{
    const label=labels[field.key] ?? field.key;
    if(!control?.onSortChange||!control.sortable?.includes(field.key))return <th className="border-b p-3 text-start" scope="col" key={field.key}>{label}</th>;
    const direction=control.sort?.field===field.key?control.sort.direction:undefined;
    const onSortChange=control.onSortChange;
    return <th className="border-b p-3 text-start" scope="col" key={field.key} aria-sort={direction==='asc'?'ascending':direction==='desc'?'descending':'none'}><button type="button" className="mp-table-sort inline-flex items-center gap-1" onClick={()=>onSortChange(nextSort(control.sort,field.key))}>{label}</button></th>;
  };
  const filterable=control?.onFiltersChange?(control.filterable??[]).filter(name=>!hiddenField(name)):[];
  const table=<div className="mp-table-wrap overflow-auto"><table className="w-full border-collapse"><caption>{caption}</caption><thead><tr>{columns.map(header)}{detail && <th className="border-b p-3 text-start" scope="col">{labels.detail ?? 'Details'}</th>}</tr></thead><tbody>{shown.map((row,index)=><tr key={rowKey ? rowKey(row,index) : index}>{columns.map(field=><td className="border-b p-3 text-start" key={field.key}>{format(row[field.key])}</td>)}{detail && <td className="border-b p-3 text-start">{detail(row)}</td>}</tr>)}</tbody></table></div>;
  if(!control)return table;
  const {page,size,sizes,onSizeChange,onFiltersChange,text}=control;
  return <div className="mp-table grid gap-4">
    {filterable.length>0&&onFiltersChange&&<form role="search" aria-label={text.filters} key={JSON.stringify(control.filters??{})} className="flex flex-wrap items-end gap-4" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);onFiltersChange(Object.fromEntries(filterable.map(name=>[name,String(data.get(name)??'')])));}}>{filterable.map(name=><Field key={name} name={name} label={labels[name] ?? name} defaultValue={control.filters?.[name] ?? ''}/>)}<Button type="submit" tone="secondary">{text.apply}</Button></form>}
    {table}
    <nav aria-label={text.pagination} className="flex flex-wrap items-center gap-4"><Button type="button" tone="ghost" disabled={page<=1} onClick={()=>control.onPageChange(page-1)}>{text.previous}</Button><span>{text.page(page,count)}</span><Button type="button" tone="ghost" disabled={count!==undefined?page>=count:control.hasMore!==true} onClick={()=>control.onPageChange(page+1)}>{text.next}</Button>{sizes&&onSizeChange&&<Select label={text.size ?? ''} value={String(size)} onChange={event=>onSizeChange(Number(event.target.value))}>{sizes.map(option=><option key={option} value={option}>{option}</option>)}</Select>}</nav>
  </div>;
}
/**
 * With `access`, a field that may not be viewed is not rendered (its label, helper and error with it) and leaves
 * validation and the submitted values; a field that may not be edited is disabled; a save passes `onSubmit` only the
 * changed fields that may be edited, compared with `original` (dirtyPatch). Without `access`, every editable field
 * shows and `onSubmit` receives nothing, as before.
 */
export function ResourceForm({fields,values,onChange,onSubmit,labels={},saveLabel,disabled=false,access,original={},helpers={},errors={}}:{fields:readonly DisplayField[];values:Readonly<Record<string,unknown>>;onChange:(key:string,value:unknown)=>void;onSubmit:(patch?:Record<string,unknown>)=>void;labels?:Readonly<Record<string,string>>;saveLabel:string;disabled?:boolean;access?:AccessReader;original?:Readonly<Record<string,unknown>>;helpers?:Readonly<Record<string,string>>;errors?:Readonly<Record<string,string>>}) {
  const editable=fields.filter(field=>field.editable);
  if(editable.some(field=>!['string','boolean','number','integer'].includes(field.type)))throw new Error('UNSUPPORTED_FORM_FIELD');
  const shown=access?editable.filter(field=>access.field(field.key).view):editable;
  const locked=(field:DisplayField)=>disabled||(access?!access.field(field.key).edit:false);
  const unavailable=disabled||shown.length===0||shown.every(locked);
  const submit=()=>{
    if(unavailable)return;
    if(!access){onSubmit();return;}
    // Only the fields shown are compared, so a hidden field never leaves; a changed field that may not be edited
    // throws FORBIDDEN_FIELD instead of being sent.
    onSubmit(access.patch(original,Object.fromEntries(shown.filter(field=>Object.hasOwn(values,field.key)).map(field=>[field.key,values[field.key]]))));
  };
  return <form className="mp-form grid gap-4" onSubmit={event=>{event.preventDefault();submit();}}>{shown.map(field=><Field key={field.key} label={labels[field.key] ?? field.key} name={field.key} required={field.required&&field.type!=='boolean'} disabled={locked(field)} {...(helpers[field.key]!==undefined?{helper:helpers[field.key]}:{})} {...(errors[field.key]!==undefined?{error:errors[field.key]}:{})} type={field.type==='boolean'?'checkbox':field.type==='number'||field.type==='integer'?'number':'text'} step={field.type==='number'?'any':field.type==='integer'?1:undefined} checked={field.type==='boolean'?values[field.key]===true:undefined} value={field.type==='boolean'?undefined:String(values[field.key] ?? '')} onChange={event=>onChange(field.key,field.type==='boolean'?event.target.checked:field.type==='number'||field.type==='integer'?event.target.valueAsNumber:event.target.value)} />)}<Button disabled={unavailable} type="submit" tone="secondary">{saveLabel}</Button></form>;
}
export {Dialog,nextFocus,type DialogProps} from './dialog.js';
export {OneTimeCodeField,ConfirmWithCode,codeDigits,type OneTimeCodeFieldProps,type ConfirmWithCodeProps} from './one-time-code.js';
export {Tree,visibleRows,descendantIds,treeKey,type TreeNode,type TreeRow,type TreeColumn,type TreeMove,type TreeProps} from './tree.js';
