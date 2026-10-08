'use client';
import {useId,useMemo,useRef,useState,type KeyboardEvent,type ReactNode,type UIEvent} from 'react';

/** A node of a hierarchy; the component reads it and never changes it. */
export type TreeNode<T=unknown>=Readonly<{id:string;label:string;children?:readonly TreeNode<T>[];data?:T}>;
/** A visible row: the node with its position in the WAI-ARIA tree structure. */
export type TreeRow<T=unknown>=Readonly<{node:TreeNode<T>;level:number;setSize:number;position:number;parentId?:string;expandable:boolean;expanded:boolean}>;
export type TreeColumn<T=unknown>=Readonly<{key:string;header:ReactNode;cell:(node:TreeNode<T>)=>ReactNode}>;

/** The rows a person can see: depth first, children only under expanded nodes. */
export function visibleRows<T>(nodes:readonly TreeNode<T>[],expanded:ReadonlySet<string>):TreeRow<T>[]{
  const rows:TreeRow<T>[]=[];
  const visit=(list:readonly TreeNode<T>[],level:number,parentId?:string)=>{
    list.forEach((node,index)=>{
      const expandable=(node.children?.length??0)>0,open=expandable&&expanded.has(node.id);
      rows.push({node,level,setSize:list.length,position:index+1,...(parentId===undefined?{}:{parentId}),expandable,expanded:open});
      if(open)visit(node.children!,level+1,node.id);
    });
  };
  visit(nodes,1);
  return rows;
}
/** Every descendant id of a node, for a consumer's bulk rule over the current children; read only. */
export function descendantIds<T>(node:TreeNode<T>):string[]{
  const ids:string[]=[];
  const visit=(list:readonly TreeNode<T>[]|undefined)=>{for(const child of list??[]){ids.push(child.id);visit(child.children);}};
  visit(node.children);
  return ids;
}
export type TreeMove=Readonly<{focus?:string;expand?:string;collapse?:string;activate?:string}>;
/**
 * The WAI-ARIA tree keyboard model for one key press. In a right-to-left context the horizontal arrows swap,
 * so that the arrow toward the start of the line always closes and moves to the parent.
 */
export function treeKey<T>(rows:readonly TreeRow<T>[],current:string|undefined,key:string,direction:'ltr'|'rtl'):TreeMove|undefined{
  const index=Math.max(0,rows.findIndex(row=>row.node.id===current)),row=rows[index];
  if(!row)return undefined;
  const inward=direction==='rtl'?'ArrowLeft':'ArrowRight',outward=direction==='rtl'?'ArrowRight':'ArrowLeft';
  switch(key){
    case 'ArrowDown':return {focus:rows[Math.min(rows.length-1,index+1)]!.node.id};
    case 'ArrowUp':return {focus:rows[Math.max(0,index-1)]!.node.id};
    case 'Home':return {focus:rows[0]!.node.id};
    case 'End':return {focus:rows[rows.length-1]!.node.id};
    case 'Enter':case ' ':return {activate:row.node.id};
    case inward:
      if(row.expandable&&!row.expanded)return {expand:row.node.id};
      if(row.expanded)return {focus:rows[index+1]!.node.id};
      return {};
    case outward:
      if(row.expanded)return {collapse:row.node.id};
      return row.parentId===undefined?{}:{focus:row.parentId};
    default:return undefined;
  }
}

export type TreeProps<T,S extends string>={
  /** The accessible name of the tree. */
  label:string;
  nodes:readonly TreeNode<T>[];
  /** Controlled: the ids of expanded nodes. */
  expanded:ReadonlySet<string>;
  onExpandedChange:(next:ReadonlySet<string>)=>void;
  /** Controlled: the consumer-defined state of each node, and the visible text of each state. */
  states?:Readonly<Record<string,S|undefined>>;
  stateLabels?:Readonly<Record<S,string>>;
  /** Enter or Space on a node; the consumer's rule decides what changes, the component decides nothing. */
  onActivate?:(node:TreeNode<T>)=>void;
  /** Columns make it a tree table (role treegrid); the first column is the node label. */
  columns?:readonly TreeColumn<T>[];
  labelHeader?:ReactNode;
  /** Rows are virtualized: a fixed row height and the viewport height in pixels. */
  rowHeight?:number;
  height?:number;
  direction?:'ltr'|'rtl';
};

/**
 * A controlled tree view, or a tree table with columns, on the WAI-ARIA tree pattern: arrows move, open and
 * close, Home and End jump, Enter and Space activate, with roving focus. Only the rows in view are rendered,
 * so that thousands of nodes stay responsive. It holds no access rule and no inheritance between states.
 */
export function Tree<T,S extends string=string>({label,nodes,expanded,onExpandedChange,states,stateLabels,onActivate,columns,labelHeader,rowHeight=40,height=480,direction}:TreeProps<T,S>){
  const rows=useMemo(()=>visibleRows(nodes,expanded),[nodes,expanded]);
  const [active,setActive]=useState<string|undefined>(undefined),[scroll,setScroll]=useState(0);
  const viewport=useRef<HTMLDivElement>(null),base=useId();
  const current=rows.some(row=>row.node.id===active)?active:rows[0]?.node.id;
  const overscan=4,first=Math.max(0,Math.floor(scroll/rowHeight)-overscan);
  const last=Math.min(rows.length,Math.ceil((scroll+height)/rowHeight)+overscan);
  const currentIndex=rows.findIndex(row=>row.node.id===current);
  // The focused row stays rendered when it is scrolled out of view, so that focus is never lost.
  const indexes=[...Array.from({length:Math.max(0,last-first)},(_,i)=>first+i)];
  if(currentIndex>=0&&(currentIndex<first||currentIndex>=last))indexes.push(currentIndex);
  const grid=columns!==undefined&&columns.length>0;
  const id=(nodeId:string)=>base+'-'+encodeURIComponent(nodeId);
  function move(target:string|undefined){
    if(target===undefined)return;
    setActive(target);
    const index=rows.findIndex(row=>row.node.id===target),element=viewport.current;
    if(element&&index>=0){
      if(index*rowHeight<element.scrollTop)element.scrollTop=index*rowHeight;
      else if((index+1)*rowHeight>element.scrollTop+height)element.scrollTop=(index+1)*rowHeight-height;
      setScroll(element.scrollTop);
    }
    queueMicrotask(()=>document.getElementById(id(target))?.focus());
  }
  function keyDown(event:KeyboardEvent<HTMLDivElement>){
    const resolved=direction??((event.currentTarget.closest('[dir]')?.getAttribute('dir')==='rtl')?'rtl':'ltr');
    const result=treeKey(rows,current,event.key,resolved);
    if(!result)return;
    event.preventDefault();
    if(result.expand)onExpandedChange(new Set([...expanded,result.expand]));
    if(result.collapse){const next=new Set(expanded);next.delete(result.collapse);onExpandedChange(next);}
    if(result.activate){const row=rows.find(entry=>entry.node.id===result.activate);if(row)onActivate?.(row.node);}
    move(result.focus);
  }
  const label_=(row:TreeRow<T>)=>{
    const state=states?.[row.node.id],stateLabel=state===undefined?undefined:stateLabels?.[state];
    return <span className="flex min-w-0 items-center gap-2 ps-[calc(var(--mp-tree-level)*1.25rem)]">
      <span aria-hidden="true" className={'mp-tree-toggle inline-block w-4 text-center'+(row.expanded?'':' rtl:-scale-x-100')}>{row.expandable?(row.expanded?'▾':'▸'):''}</span>
      <span id={id(row.node.id)+'-name'} className="truncate">{row.node.label}</span>
      {stateLabel!==undefined&&<span id={id(row.node.id)+'-state'} className="mp-tree-state ms-auto text-xs" data-state={state}>{stateLabel}</span>}
    </span>;
  };
  return <div ref={viewport} role={grid?'treegrid':'tree'} aria-label={label} aria-rowcount={grid?rows.length+1:undefined}
    className="mp-tree relative overflow-auto rounded-[var(--mp-radius-control)] border h-[var(--mp-tree-height)]"
    style={{'--mp-tree-height':height+'px'} as never} onKeyDown={keyDown} onScroll={(event:UIEvent<HTMLDivElement>)=>setScroll(event.currentTarget.scrollTop)}>
    {grid&&<div role="row" aria-rowindex={1} className="mp-tree-header sticky top-0 z-10 flex border-b">
      <span role="columnheader" className="flex-1 p-2 text-start">{labelHeader}</span>
      {columns!.map(column=><span key={column.key} role="columnheader" className="w-40 p-2 text-start">{column.header}</span>)}
    </div>}
    <div className="relative h-[var(--mp-tree-total)]" style={{'--mp-tree-total':rows.length*rowHeight+'px'} as never} role={grid?'rowgroup':'none'}>
      {indexes.map(index=>{
        const row=rows[index]!,focused=row.node.id===current,state=states?.[row.node.id];
        const shared={id:id(row.node.id),tabIndex:focused?0:-1,'aria-level':row.level,'aria-setsize':row.setSize,'aria-posinset':row.position,
          ...(row.expandable?{'aria-expanded':row.expanded}:{}),
          'aria-labelledby':id(row.node.id)+'-name'+(state!==undefined&&stateLabels?.[state]!==undefined?' '+id(row.node.id)+'-state':''),
          'data-focused':focused||undefined,onFocus:()=>setActive(row.node.id),onClick:()=>{setActive(row.node.id);onActivate?.(row.node);},
          className:'mp-tree-item absolute inset-x-0 flex h-[var(--mp-tree-row)] translate-y-[var(--mp-tree-offset)] cursor-pointer items-center',
          style:{'--mp-tree-row':rowHeight+'px','--mp-tree-offset':index*rowHeight+'px','--mp-tree-level':row.level-1} as never};
        return grid
          ?<div key={row.node.id} role="row" aria-rowindex={index+2} {...shared}>
            <span role="gridcell" className="flex-1 p-2 text-start">{label_(row)}</span>
            {columns!.map(column=><span key={column.key} role="gridcell" className="w-40 p-2 text-start">{column.cell(row.node)}</span>)}
          </div>
          :<div key={row.node.id} role="treeitem" {...shared}><span className="flex-1 px-2">{label_(row)}</span></div>;
      })}
    </div>
  </div>;
}
