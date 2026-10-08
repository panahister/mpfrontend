'use client';
import {useEffect,useId,useRef,type KeyboardEvent,type ReactNode} from 'react';

const focusable='a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The next element of a Tab or Shift+Tab press inside a trap: the ends wrap around. */
export function nextFocus<T>(elements:readonly T[],current:T|null,backwards:boolean):T|undefined{
  if(!elements.length)return undefined;
  const index=current===null?-1:elements.indexOf(current);
  if(backwards)return index<=0?elements[elements.length-1]:elements[index-1];
  return index<0||index===elements.length-1?elements[0]:elements[index+1];
}

export type DialogProps={
  open:boolean;
  title:ReactNode;
  /** Called on Escape, on the close button and on the browser's own cancel; the parent closes the dialog. */
  onClose:()=>void;
  /** The accessible name of the close button; every visible text is the consumer's. */
  closeLabel:string;
  children:ReactNode;
  description?:ReactNode;
};

/**
 * A modal dialog on the native dialog element: aria-modal, labelled by its title (and described by its
 * description), Escape closes it, a focus guard keeps Tab inside it, and focus returns to the element that
 * opened it. It uses logical properties only, so it reads the same in both directions.
 */
export function Dialog({open,title,onClose,closeLabel,children,description}:DialogProps){
  const ref=useRef<HTMLDialogElement>(null),opener=useRef<Element|null>(null);
  const titleId=useId(),descriptionId=useId();
  useEffect(()=>{
    const dialog=ref.current;if(!dialog)return;
    if(open){
      opener.current=document.activeElement;
      if(!dialog.open){if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');}
      const first=dialog.querySelector<HTMLElement>('[data-autofocus]')??dialog.querySelector<HTMLElement>(focusable);
      (first??dialog).focus();
      return;
    }
    if(dialog.open){if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
    const previous=opener.current as HTMLElement|null;opener.current=null;
    if(previous&&typeof previous.focus==='function'&&previous.isConnected)previous.focus();
  },[open]);
  function keyDown(event:KeyboardEvent<HTMLDialogElement>){
    if(event.key==='Escape'){event.preventDefault();onClose();return;}
    if(event.key!=='Tab')return;
    const elements=[...event.currentTarget.querySelectorAll<HTMLElement>(focusable)];
    const target=nextFocus(elements,document.activeElement as HTMLElement|null,event.shiftKey);
    if(target){event.preventDefault();target.focus();}
  }
  return <dialog ref={ref} aria-modal="true" aria-labelledby={titleId} aria-describedby={description===undefined?undefined:descriptionId}
    onKeyDown={keyDown} onCancel={event=>{event.preventDefault();onClose();}}
    className="mp-dialog m-auto w-[min(100%-2rem,32rem)] rounded-[var(--mp-radius-surface)] border p-6">
    {open&&<div className="grid gap-4">
      <div className="flex items-start justify-between gap-4">
        <h2 id={titleId} className="m-0 text-start text-xl font-semibold">{title}</h2>
        <button type="button" className="mp-dialog-close rounded-[var(--mp-radius-control)] px-2" aria-label={closeLabel} onClick={onClose}>×</button>
      </div>
      {description!==undefined&&<p id={descriptionId} className="m-0">{description}</p>}
      {children}
    </div>}
  </dialog>;
}
