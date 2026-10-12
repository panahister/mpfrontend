import {can,type PageAccess} from './page-access.js';
import type {AccessKeys} from './snapshot.js';

/** An element of a page. Without `capability` its own id is its capability key. */
export type ManifestElement=Readonly<{id:string;capability?:string}>;
/**
 * One route. `page` is the capability the page needs; `menu`, when set, is the capability its menu entry needs.
 * `fields` lists the field keys the page's components read.
 */
export type ManifestPage=Readonly<{id:string;route:string;page:string;menu?:string;elements?:readonly ManifestElement[];fields?:readonly string[]}>;
/** A navigation group: its own menu capability and its children, page or group ids, in order. */
export type ManifestGroup=Readonly<{id:string;menu:string;children:readonly string[]}>;
/** Every route of an app, its navigation groups and the order of the top level of its navigation. */
export type PageManifest=Readonly<{pages:readonly ManifestPage[];groups?:readonly ManifestGroup[];navigation?:readonly string[]}>;
export type NavigationEntry=
  | Readonly<{kind:'page';id:string;route:string}>
  | Readonly<{kind:'group';id:string;children:readonly NavigationEntry[]}>;
export type ManifestProblem=Readonly<{
  code:'DUPLICATE_ID'|'UNREGISTERED_ID'|'UNLISTED_ROUTE'|'UNKNOWN_CHILD'|'NO_MENU'|'NAVIGATION_CYCLE';
  id:string;
}>;

function deepFreeze<T>(value:T):T{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))deepFreeze(child);Object.freeze(value);}
  return value;
}
/** Defines the manifest once, frozen. Ids are stable strings; checkPageManifest finds duplicates and gaps. */
export function definePageManifest<const M extends PageManifest>(manifest:M):M{return deepFreeze(manifest);}
export function elementCapability(element:ManifestElement):string{return element.capability??element.id;}

const unique=(values:Iterable<string>)=>[...new Set(values)];
/** The keys one page's components read: its page and menu capabilities, its elements' capabilities and its fields. */
export function pageKeys(manifest:PageManifest,pageId:string):AccessKeys{
  const page=manifest.pages.find(entry=>entry.id===pageId);
  if(!page)return {capabilities:[],fields:[]};
  return {capabilities:unique([page.page,...(page.menu?[page.menu]:[]),...(page.elements??[]).map(elementCapability)]),fields:unique(page.fields??[])};
}
/** The keys navigation reads: every group's menu capability and the menu and page capability of every page with a menu. */
export function navigationKeys(manifest:PageManifest):AccessKeys{
  return {capabilities:unique([...(manifest.groups??[]).map(group=>group.menu),
    ...manifest.pages.flatMap(page=>page.menu?[page.menu,page.page]:[])]),fields:[]};
}
/** Every key the manifest declares: the known keys a snapshot is checked against. */
export function manifestKeys(manifest:PageManifest):AccessKeys{
  const pages=manifest.pages.map(page=>pageKeys(manifest,page.id));
  return {capabilities:unique([...navigationKeys(manifest).capabilities,...pages.flatMap(keys=>keys.capabilities)]),
    fields:unique(pages.flatMap(keys=>keys.fields))};
}

/**
 * Navigation from the manifest and the snapshot. A page shows when the snapshot grants both its menu and its page
 * capability; a group shows when it grants the group's menu and at least one child shows. A parent's visibility
 * grants no child, and a group with no visible child is pruned.
 */
export function buildNavigation(manifest:PageManifest,access:PageAccess|undefined,now=Date.now()):NavigationEntry[]{
  const pages=new Map(manifest.pages.map(page=>[page.id,page])),groups=new Map((manifest.groups??[]).map(group=>[group.id,group]));
  const visit=(id:string,path:ReadonlySet<string>):NavigationEntry|undefined=>{
    if(path.has(id))return undefined;
    const page=pages.get(id);
    if(page)return page.menu&&can(access,page.menu,now)&&can(access,page.page,now)?Object.freeze({kind:'page',id,route:page.route}):undefined;
    const group=groups.get(id);
    if(!group||!can(access,group.menu,now))return undefined;
    const inner=new Set(path).add(id);
    const children=group.children.map(child=>visit(child,inner)).filter((entry):entry is NavigationEntry=>entry!==undefined);
    return children.length?Object.freeze({kind:'group',id,children:Object.freeze(children)}):undefined;
  };
  return (manifest.navigation??[]).map(id=>visit(id,new Set())).filter((entry):entry is NavigationEntry=>entry!==undefined);
}

/**
 * The problems a test reports: an id defined twice, an id the app uses that the manifest does not register (ids and
 * capability keys are registered), an app route without a page entry, a navigation child that is neither a page nor
 * a group, a page in navigation without a menu capability, and a group that contains itself.
 */
export function checkPageManifest(manifest:PageManifest,input:Readonly<{routes?:Iterable<string>;ids?:Iterable<string>}>={}):ManifestProblem[]{
  const problems:ManifestProblem[]=[],seen=new Set<string>();
  const ids=[...manifest.pages.map(page=>page.id),...(manifest.groups??[]).map(group=>group.id),
    ...manifest.pages.flatMap(page=>(page.elements??[]).map(element=>element.id))];
  for(const id of ids){if(seen.has(id))problems.push({code:'DUPLICATE_ID',id});seen.add(id);}
  const registered=new Set([...ids,...manifestKeys(manifest).capabilities]);
  for(const id of unique(input.ids??[]))if(!registered.has(id))problems.push({code:'UNREGISTERED_ID',id});
  const routes=new Set(manifest.pages.map(page=>page.route));
  for(const route of unique(input.routes??[]))if(!routes.has(route))problems.push({code:'UNLISTED_ROUTE',id:route});
  const pages=new Map(manifest.pages.map(page=>[page.id,page])),groups=new Map((manifest.groups??[]).map(group=>[group.id,group]));
  const reported=new Set<string>();
  const walk=(id:string,path:readonly string[])=>{
    if(path.includes(id)){if(!reported.has('cycle:'+id)){reported.add('cycle:'+id);problems.push({code:'NAVIGATION_CYCLE',id});}return;}
    const page=pages.get(id),group=groups.get(id);
    if(page){if(!page.menu&&!reported.has('menu:'+id)){reported.add('menu:'+id);problems.push({code:'NO_MENU',id});}return;}
    if(!group){if(!reported.has('child:'+id)){reported.add('child:'+id);problems.push({code:'UNKNOWN_CHILD',id});}return;}
    for(const child of group.children)walk(child,[...path,id]);
  };
  for(const id of manifest.navigation??[])walk(id,[]);
  for(const group of manifest.groups??[])for(const child of group.children)if(!pages.has(child)&&!groups.has(child)&&!reported.has('child:'+child)){
    reported.add('child:'+child);problems.push({code:'UNKNOWN_CHILD',id:child});
  }
  return problems;
}
/** Throws PAGE_MANIFEST_INVALID with every problem, for a test of the consumer's manifest. */
export function assertPageManifest(manifest:PageManifest,input:Readonly<{routes?:Iterable<string>;ids?:Iterable<string>}>={}):void{
  const problems=checkPageManifest(manifest,input);
  if(problems.length)throw new Error('PAGE_MANIFEST_INVALID '+problems.map(problem=>problem.code+':'+problem.id).join(' '));
}
