import {readFile,lstat,realpath,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {dirname,resolve,relative,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

// A finite reviewed-export profile, not a Figma extractor or a business/React generator.
const cliVersion=String(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version);
export class DesignError extends Error{constructor(message:string,readonly exitCode=2){super(message);}}
type Value=string|number|{value:number;unit:'px'|'rem'|'em'|'%'}|{alias:string};
type Token={id:string;name:string;type:'color'|'dimension'|'number'|'string';values:{light:Value;dark:Value}};
type Component={id:string;name:string;variants:Record<string,string[]>;properties:Record<string,string>;
  behavior:{status:'known'|'unknown';description:string};assets:string[]};
type Asset={id:string;sha256:string;mimeType:string;license:string};
type Snapshot={schemaVersion:1;source:{fileKey:string;nodeId:string;revision:string|null;capturedAt:string|null;extractorVersion:string};
  modes:['light','dark'];tokens:Token[];components:Component[];assets:Asset[]};
type Binding={schemaVersion:1;id:string;source:{fileKey:string;nodeId:string};brandId:string;modeAttribute:'data-mode'|'data-theme';stateDirectory:string;outputDirectory:string;
  tokens:Array<{sourceId:string;cssName:string}>;components:Array<{sourceId:string;adapter:string;tests:string[]}>;
  ignoredTokens:Array<{sourceId:string;reason:string}>;ignoredComponents:Array<{sourceId:string;reason:string}>};
type Change={kind:'token'|'component'|'asset';id:string;action:'added'|'removed'|'changed';areas:string[];severity:'additive'|'visual'|'breaking'};
type Task={id:string;kind:'component'|'migration'|'asset';requiredFiles:string[]};
type Plan={schemaVersion:1;generator:'MPFrontendDesign';cliVersion:string;bindingFile:string;bindingHash:string;candidateHash:string;
  baselineHash:string|null;ownershipHash:string|null;before:Record<string,string|null>;after:Record<string,string>;
  changes:Change[];tasks:Task[];checks:string[];diagnostics:string[];planId:string};
type Ownership={schemaVersion:1;generator:'MPFrontendDesign';cliVersion:string;bindingHash:string;candidateHash:string;planId:string;outputs:Record<string,string>};
type Baseline={schemaVersion:1;generator:'MPFrontendDesign';cliVersion:string;candidateHash:string;planId:string;bindingHash:string;evidenceHash:string;evidencePath:string};
type Evidence={schemaVersion:1;planId:string;candidateHash:string;bindingHash:string;cliVersion:string;
  review:{approved:boolean;reviewer:string};checks:Array<{name:string;passed:boolean;command:string;artifact:{path:string;sha256:string}}>;
  tasks:Array<{id:string;status:'implemented';files:Array<{path:string;sha256:string}>}>};
type Context={root:string;bindingFile:string;binding:Binding;bindingHash:string};
export type DesignOptions={command:string;bindingPath?:string;snapshotPath?:string;candidate?:string;planPath?:string;evidencePath?:string;dryRun?:boolean};
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
const hex=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function ensure(value:unknown,message:string,code=2):asserts value{if(!value)throw new DesignError(message,code);}
function text(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=1024&&!/[\u0000-\u001f]/.test(value);}
function id(value:unknown):value is string{return typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value);}
function object(value:unknown,keys?:string[]):Record<string,unknown>{
  ensure(value!==null&&typeof value==='object'&&!Array.isArray(value),'INVALID_DESIGN_OBJECT');
  const result=value as Record<string,unknown>;
  ensure(Object.keys(result).every(key=>!['__proto__','constructor','prototype'].includes(key)),'UNSAFE_DESIGN_KEY');
  if(keys)ensure(Object.keys(result).length===keys.length&&keys.every(key=>Object.hasOwn(result,key)),'INVALID_DESIGN_FIELDS');
  return result;
}
function list(value:unknown):unknown[]{ensure(Array.isArray(value)&&value.length<=3000,'INVALID_DESIGN_LIST');return value;}
function unique(values:string[],message='DUPLICATE_DESIGN_ID'){ensure(new Set(values).size===values.length,message);}
function canonical(value:unknown,depth=0):unknown{
  ensure(depth<64,'DESIGN_STRUCTURE_TOO_DEEP');
  if(Array.isArray(value))return value.map(item=>canonical(item,depth+1));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,item])=>[key,canonical(item,depth+1)]));
  return value;
}
const encode=(value:unknown)=>JSON.stringify(canonical(value),null,2)+'\n';
function safePath(path:unknown):asserts path is string{
  ensure(typeof path==='string'&&path.length<=500&&/^[a-zA-Z0-9_./-]+$/.test(path)&&
    path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!['.git','.aws','.codex','.agents','.claude','node_modules'].includes(part)),'UNSAFE_DESIGN_PATH',4);
}
async function rawBytes(root:string,path:string):Promise<Buffer|undefined>{
  safePath(path);let current=root;
  for(const part of path.split('/')){
    current=join(current,part);
    try{const info=await lstat(current);ensure(!info.isSymbolicLink(),'DESIGN_PATH_SYMLINK',4);
      ensure(current===join(root,path)?info.isFile():info.isDirectory(),'DESIGN_PATH_KIND',4);
      if(current===join(root,path))ensure(info.size<=5*1024*1024,'DESIGN_FILE_TOO_LARGE');
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  }
  const result=await readFile(current);ensure(result.length<=5*1024*1024,'DESIGN_FILE_TOO_LARGE');return result;
}
async function bytes(root:string,path:string):Promise<string|undefined>{return (await rawBytes(root,path))?.toString('utf8');}
function json(value:string|undefined):unknown{ensure(value!==undefined,'DESIGN_FILE_MISSING');try{return JSON.parse(value);}catch{throw new DesignError('INVALID_DESIGN_JSON');}}
function parseSnapshot(raw:unknown):Snapshot{
  const value=object(raw,['schemaVersion','source','modes','tokens','components','assets']);ensure(value.schemaVersion===1,'UNSUPPORTED_DESIGN_SNAPSHOT');
  const source=object(value.source,['fileKey','nodeId','revision','capturedAt','extractorVersion']);
  ensure(id(source.fileKey)&&id(source.nodeId)&&(source.revision===null||text(source.revision))&&text(source.extractorVersion)&&
    (source.capturedAt===null||typeof source.capturedAt==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(source.capturedAt)&&Number.isFinite(Date.parse(source.capturedAt))),'INVALID_DESIGN_SOURCE');
  ensure(encode(value.modes)===encode(['light','dark']),'DESIGN_LIGHT_DARK_REQUIRED');
  const tokens=list(value.tokens).map(raw=>{
    const token=object(raw,['id','name','type','values']);ensure(id(token.id)&&text(token.name)&&['color','dimension','number','string'].includes(String(token.type)),'INVALID_DESIGN_TOKEN');
    const values=object(token.values,['light','dark']);
    for(const raw of Object.values(values)){
      if(raw&&typeof raw==='object'){
        const item=object(raw);
        if(Object.hasOwn(item,'alias')){object(item,['alias']);ensure(id(item.alias),'INVALID_DESIGN_ALIAS');}
        else{object(item,['value','unit']);ensure(token.type==='dimension'&&typeof item.value==='number'&&Number.isFinite(item.value)&&Math.abs(item.value)<=1000000&&['px','rem','em','%'].includes(String(item.unit)),'INVALID_DESIGN_DIMENSION');}
      }else if(token.type==='color')ensure(typeof raw==='string'&&/^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(raw),'INVALID_DESIGN_COLOR');
      else if(token.type==='number')ensure(typeof raw==='number'&&Number.isFinite(raw)&&Math.abs(raw)<=1000000,'INVALID_DESIGN_NUMBER');
      else if(token.type==='string')ensure(typeof raw==='string'&&raw.length>0&&raw.length<=256&&/^[a-zA-Z0-9 _.,-]+$/.test(raw),'UNSUPPORTED_DESIGN_STRING');
      else throw new DesignError('INVALID_DESIGN_DIMENSION');
    }
    return token as unknown as Token;
  });unique(tokens.map(t=>t.id));
  const components=list(value.components).map(raw=>{
    const component=object(raw,['id','name','variants','properties','behavior','assets']);ensure(id(component.id)&&text(component.name),'INVALID_DESIGN_COMPONENT');
    for(const [key,values]of Object.entries(object(component.variants))){ensure(id(key),'INVALID_DESIGN_VARIANT');const entries=list(values);ensure(entries.every(text),'INVALID_DESIGN_VARIANT');unique(entries as string[]);}
    ensure(Object.entries(object(component.properties)).every(([key,value])=>id(key)&&text(value)),'INVALID_DESIGN_PROPERTY');
    const behavior=object(component.behavior,['status','description']);ensure(['known','unknown'].includes(String(behavior.status))&&text(behavior.description),'INVALID_DESIGN_BEHAVIOR');
    ensure(list(component.assets).every(id),'INVALID_DESIGN_ASSET_REFERENCE');unique(component.assets as string[]);
    return component as unknown as Component;
  });unique(components.map(c=>c.id));
  const assets=list(value.assets).map(raw=>{
    const asset=object(raw,['id','sha256','mimeType','license']);ensure(id(asset.id)&&hex(asset.sha256)&&text(asset.mimeType)&&text(asset.license),'INVALID_DESIGN_ASSET');return asset as unknown as Asset;
  });unique(assets.map(a=>a.id));
  const snapshot={...value,tokens:tokens.sort((a,b)=>a.id.localeCompare(b.id,'en')),components:components.sort((a,b)=>a.id.localeCompare(b.id,'en')),assets:assets.sort((a,b)=>a.id.localeCompare(b.id,'en'))} as unknown as Snapshot;
  for(const token of snapshot.tokens)for(const mode of snapshot.modes)resolveValue(snapshot,token,mode,new Set());
  for(const component of components)ensure(component.assets.every(id=>assets.some(a=>a.id===id)),'MISSING_DESIGN_ASSET');
  return snapshot;
}
function resolveValue(snapshot:Snapshot,token:Token,mode:'light'|'dark',visited:Set<string>):Value{
  ensure(!visited.has(token.id)&&visited.size<64,'DESIGN_ALIAS_CYCLE');
  const value=token.values[mode];
  if(value&&typeof value==='object'&&'alias'in value){
    const target=snapshot.tokens.find(t=>t.id===value.alias);ensure(target&&target.type===token.type,'UNRESOLVED_OR_INCOMPATIBLE_DESIGN_ALIAS');
    return resolveValue(snapshot,target,mode,new Set([...visited,token.id]));
  }return value;
}
function parseBinding(raw:unknown):Binding{
  const value=object(raw,['schemaVersion','id','source','brandId','modeAttribute','stateDirectory','outputDirectory','tokens','components','ignoredTokens','ignoredComponents']);
  ensure(value.schemaVersion===1&&typeof value.id==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value.id),'INVALID_DESIGN_BINDING');
  const source=object(value.source,['fileKey','nodeId']);ensure(id(source.fileKey)&&id(source.nodeId),'INVALID_DESIGN_BINDING_SOURCE');
  ensure(typeof value.brandId==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(value.brandId)&&['data-mode','data-theme'].includes(String(value.modeAttribute)),'INVALID_DESIGN_BRAND_SELECTOR');
  safePath(value.stateDirectory);safePath(value.outputDirectory);
  ensure(value.stateDirectory==='.mpfrontend/design/'+value.id&&/^(?:themes|packages)\/.+\/generated$/.test(value.outputDirectory),'INVALID_DESIGN_OWNED_DIRECTORY',4);
  const tokens=list(value.tokens).map(raw=>{const item=object(raw,['sourceId','cssName']);ensure(id(item.sourceId)&&typeof item.cssName==='string'&&/^--[a-z][a-z0-9-]*$/.test(item.cssName),'INVALID_DESIGN_TOKEN_BINDING');return item as unknown as Binding['tokens'][number];});
  unique(tokens.map(t=>t.sourceId));unique(tokens.map(t=>t.cssName),'DUPLICATE_DESIGN_CSS_NAME');
  const components=list(value.components).map(raw=>{
    const item=object(raw,['sourceId','adapter','tests']);ensure(id(item.sourceId),'INVALID_DESIGN_COMPONENT_BINDING');safePath(item.adapter);
    const tests=list(item.tests);ensure(tests.length>0,'DESIGN_COMPONENT_TESTS_REQUIRED');for(const path of tests)safePath(path);unique(tests as string[]);
    return item as unknown as Binding['components'][number];
  });unique(components.map(c=>c.sourceId));
  for(const entry of components)for(const path of [entry.adapter,...entry.tests])ensure(!path.startsWith('.mpfrontend/')&&!path.startsWith(value.outputDirectory+'/'),'DESIGN_AUTHORED_PATH_REQUIRED',4);
  const ignored=(raw:unknown)=>list(raw).map(raw=>{const item=object(raw,['sourceId','reason']);ensure(id(item.sourceId)&&text(item.reason),'INVALID_DESIGN_IGNORED_MAPPING');return item as unknown as Binding['ignoredTokens'][number];});
  const ignoredTokens=ignored(value.ignoredTokens),ignoredComponents=ignored(value.ignoredComponents);
  unique([...tokens.map(t=>t.sourceId),...ignoredTokens.map(t=>t.sourceId)]);unique([...components.map(c=>c.sourceId),...ignoredComponents.map(c=>c.sourceId)]);
  return {...value,tokens,components,ignoredTokens,ignoredComponents} as unknown as Binding;
}
async function context(bindingPath:string):Promise<Context>{
  const root=await realpath(dirname(resolve(bindingPath))),bindingFile=join(root,relative(dirname(resolve(bindingPath)),resolve(bindingPath)));
  const binding=parseBinding(json(await bytes(root,relative(root,bindingFile))));
  const result={root,bindingFile,binding,bindingHash:sha(encode(binding))};
  ensure(await bytes(root,binding.stateDirectory+'/.design-write.lock')===undefined,'DESIGN_SYNC_BUSY',4);return result;
}
export async function inspectDesignBinding(bindingPath:string){
  const ctx=await context(bindingPath);
  return {bindingFile:ctx.bindingFile,bindingHash:ctx.bindingHash,id:ctx.binding.id,source:ctx.binding.source,
    stateDirectory:ctx.binding.stateDirectory,outputDirectory:ctx.binding.outputDirectory};
}
export async function inspectDesignSnapshot(snapshotPath:string){
  const source=resolve(snapshotPath),sourceRoot=await realpath(dirname(source)),raw=await rawBytes(sourceRoot,relative(dirname(source),source));
  const snapshot=parseSnapshot(json(raw?.toString('utf8'))),content=encode(snapshot);
  return {snapshotFile:source,rawHash:createHash('sha256').update(raw!).digest('hex'),candidateHash:sha(content),source:snapshot.source};
}
async function candidate(ctx:Context,hash:string):Promise<Snapshot>{
  ensure(hex(hash),'INVALID_DESIGN_CANDIDATE');
  const value=parseSnapshot(json(await bytes(ctx.root,ctx.binding.stateDirectory+'/snapshots/'+hash+'.json')));
  ensure(sha(encode(value))===hash,'DESIGN_CANDIDATE_DRIFT',3);
  ensure(encode({fileKey:value.source.fileKey,nodeId:value.source.nodeId})===encode(ctx.binding.source),'DESIGN_SOURCE_MISMATCH');return value;
}
function diagnostics(binding:Binding,snapshot:Snapshot):string[]{
  const issues:string[]=[];
  for(const token of snapshot.tokens)if(!binding.tokens.some(t=>t.sourceId===token.id)&&!binding.ignoredTokens.some(t=>t.sourceId===token.id))issues.push('UNMAPPED_TOKEN:'+token.id);
  for(const token of binding.tokens)if(!snapshot.tokens.some(t=>t.id===token.sourceId))issues.push('MISSING_BOUND_TOKEN:'+token.sourceId);
  for(const component of snapshot.components){
    if(!binding.components.some(c=>c.sourceId===component.id)&&!binding.ignoredComponents.some(c=>c.sourceId===component.id))issues.push('UNMAPPED_COMPONENT:'+component.id);
    if(component.behavior.status==='unknown'&&binding.components.some(c=>c.sourceId===component.id))issues.push('UNKNOWN_COMPONENT_BEHAVIOR:'+component.id);
  }
  for(const asset of snapshot.assets)if(asset.license==='unknown')issues.push('UNRESOLVED_ASSET_LICENSE:'+asset.id);
  return issues.sort();
}
async function baseline(ctx:Context):Promise<{bytes:string|undefined;value:Baseline|undefined;snapshot:Snapshot|undefined}>{
  const old=await bytes(ctx.root,ctx.binding.stateDirectory+'/baseline.json');if(old===undefined)return {bytes:old,value:undefined,snapshot:undefined};
  const value=object(json(old),['schemaVersion','generator','cliVersion','candidateHash','planId','bindingHash','evidenceHash','evidencePath']);
  ensure(value.schemaVersion===1&&value.generator==='MPFrontendDesign'&&text(value.cliVersion)&&[value.candidateHash,value.planId,value.bindingHash,value.evidenceHash].every(hex),'INVALID_DESIGN_BASELINE',4);
  safePath(value.evidencePath);ensure(value.evidencePath.startsWith('evidence/'),'INVALID_DESIGN_BASELINE_EVIDENCE',4);
  return {bytes:old,value:value as unknown as Baseline,snapshot:await candidate(ctx,value.candidateHash as string)};
}
function changes(before:Snapshot|undefined,after:Snapshot):Change[]{
  const result:Change[]=[];
  for(const [kind,old,next]of [['token',before?.tokens??[],after.tokens],['component',before?.components??[],after.components],['asset',before?.assets??[],after.assets]] as const){
    for(const id of [...new Set([...old,...next].map(item=>item.id))].sort()){
      const a=old.find(item=>item.id===id),b=next.find(item=>item.id===id);
      if(encode(a)===encode(b))continue;
      const action=!a?'added':!b?'removed':'changed';
      const areas=a&&b?[...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>encode((a as unknown as Record<string,unknown>)[key])!==encode((b as unknown as Record<string,unknown>)[key])).sort():[];
      const severity=action==='removed'||areas.some(key=>['type','properties','behavior','variants'].includes(key))?'breaking':action==='added'?'additive':'visual';
      result.push({kind,id,action,areas,severity});
    }
  }return result;
}
function outputs(ctx:Context,snapshot:Snapshot):Record<string,string>{
  const css=(mode:'light'|'dark')=>ctx.binding.tokens.map(item=>{
    const token=snapshot.tokens.find(t=>t.id===item.sourceId);ensure(token,'MISSING_BOUND_TOKEN');const raw=resolveValue(snapshot,token,mode,new Set());
    const value=typeof raw==='object'&&'value'in raw?String(raw.value)+raw.unit:token.type==='string'?JSON.stringify(raw):String(raw);
    return '  '+item.cssName+': '+value+';';
  }).sort().join('\n');
  const folder=ctx.binding.outputDirectory;
  const selector=':root[data-brand="'+ctx.binding.brandId+'"]',mode=ctx.binding.modeAttribute;
  return {[folder+'/tokens.gen.css']:'/* @generated by MPFrontendDesign; consumer overrides remain authored. */\n'+selector+', '+selector+'['+mode+'="light"] {\n'+css('light')+'\n}\n'+selector+'['+mode+'="dark"] {\n'+css('dark')+'\n}\n@media (prefers-color-scheme:dark) {\n'+selector+'['+mode+'="system"] {\n'+css('dark')+'\n}\n}\n',
    [folder+'/components.gen.json']:encode({schemaVersion:1,generator:'MPFrontendDesign',components:snapshot.components.filter(c=>ctx.binding.components.some(b=>b.sourceId===c.id)),assets:snapshot.assets})};
}
async function ownership(ctx:Context):Promise<{bytes:string|undefined;value:Ownership|undefined}>{
  const old=await bytes(ctx.root,ctx.binding.stateDirectory+'/ownership.json');if(old===undefined)return {bytes:old,value:undefined};
  const value=object(json(old),['schemaVersion','generator','cliVersion','bindingHash','candidateHash','planId','outputs']);
  ensure(value.schemaVersion===1&&value.generator==='MPFrontendDesign'&&text(value.cliVersion)&&[value.bindingHash,value.candidateHash,value.planId].every(hex),'INVALID_DESIGN_OWNERSHIP',4);
  const files=object(value.outputs);ensure(Object.keys(files).length===2&&Object.keys(files).every(path=>[ctx.binding.outputDirectory+'/tokens.gen.css',ctx.binding.outputDirectory+'/components.gen.json'].includes(path))&&Object.values(files).every(hex),'DESIGN_OUTPUT_LOCATION_OR_OWNERSHIP_CHANGED',4);
  for(const [path,digest]of Object.entries(files))ensure(sha(await bytes(ctx.root,path)??'')===digest,'DESIGN_OUTPUT_DRIFT:'+path,3);
  return {bytes:old,value:value as unknown as Ownership};
}
async function buildPlan(ctx:Context,hash:string):Promise<Plan>{
  const next=await candidate(ctx,hash),accepted=await baseline(ctx),owned=await ownership(ctx),delta=changes(accepted.snapshot,next);
  const issues=diagnostics(ctx.binding,next),generated=issues.length?{}:outputs(ctx,next),before:Record<string,string|null>={},after:Record<string,string>={};
  for(const [path,content]of Object.entries(generated)){
    const old=await bytes(ctx.root,path);ensure(old===undefined||owned.value?.outputs[path]===sha(old),'AUTHORED_DESIGN_OUTPUT_COLLISION:'+path,4);
    before[path]=old===undefined?null:sha(old);after[path]=sha(content);
  }
  const tasks:Task[]=delta.filter(change=>change.kind!=='token'||change.action==='removed'||change.areas.includes('name')).map(change=>{
    const mapping=ctx.binding.components.find(c=>c.sourceId===change.id);
    return {id:change.kind+':'+change.id+':'+change.action,kind:change.kind==='component'?'component':change.kind==='asset'?'asset':'migration',requiredFiles:mapping?[mapping.adapter,...mapping.tests]:[]};
  });
  for(const mapping of ctx.binding.components)if(next.components.some(c=>c.id===mapping.sourceId)&&!delta.some(change=>change.kind==='component'&&change.id===mapping.sourceId))
    tasks.push({id:'component:'+mapping.sourceId+':verify',kind:'component',requiredFiles:[mapping.adapter,...mapping.tests]});
  for(const change of delta.filter(c=>c.kind==='component'&&c.action==='removed'))if(!ctx.binding.components.some(c=>c.sourceId===change.id))issues.push('REMOVED_COMPONENT_BINDING_REQUIRED:'+change.id);
  const draft={schemaVersion:1 as const,generator:'MPFrontendDesign' as const,cliVersion,bindingFile:ctx.bindingFile,bindingHash:ctx.bindingHash,candidateHash:hash,
    baselineHash:accepted.bytes===undefined?null:sha(accepted.bytes),ownershipHash:owned.bytes===undefined?null:sha(owned.bytes),before,after,changes:delta,tasks,
    checks:['unit','typecheck','visual-light','visual-dark','rtl','keyboard','contrast',...(next.assets.length?['asset-rights']:[])],diagnostics:issues};
  return {...draft,planId:sha(encode(draft))};
}
async function writeBatch(ctx:Context,desired:Record<string,string>,expected:Record<string,string|undefined>,dryRun:boolean){
  const changed:string[]=[];
  const guardBinding=async()=>ensure(sha(encode(parseBinding(json(await bytes(ctx.root,relative(ctx.root,ctx.bindingFile))))))===ctx.bindingHash,'CONCURRENT_DESIGN_BINDING_EDIT',4);
  await guardBinding();
  for(const [path,value]of Object.entries(desired)){const old=await bytes(ctx.root,path);ensure(old===expected[path],'CONCURRENT_DESIGN_EDIT:'+path,4);if(old!==value)changed.push(path);}
  if(dryRun||!changed.length)return changed;
  const marker=ctx.binding.stateDirectory+'/.design-write.lock',owner=randomUUID(),staged=new Map<string,string>(),replaced:string[]=[];
  let acquired=false;
  try{
    await mkdir(join(ctx.root,ctx.binding.stateDirectory),{recursive:true});await bytes(ctx.root,marker);
    try{await writeFile(join(ctx.root,marker),owner,{flag:'wx'});acquired=true;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new DesignError('DESIGN_SYNC_BUSY',4);throw error;}
    for(const path of changed){
      ensure(await bytes(ctx.root,path)===expected[path],'CONCURRENT_DESIGN_EDIT:'+path,4);
      await mkdir(dirname(join(ctx.root,path)),{recursive:true});await bytes(ctx.root,path);
      const stage=relative(ctx.root,join(dirname(join(ctx.root,path)),'.design-stage-'+randomUUID()));
      await writeFile(join(ctx.root,stage),desired[path]!,{flag:'wx'});staged.set(path,stage);
    }
    await guardBinding();
    for(const [path,stage]of staged){ensure(await bytes(ctx.root,path)===expected[path],'CONCURRENT_DESIGN_EDIT:'+path,4);await rename(join(ctx.root,stage),join(ctx.root,path));staged.delete(path);replaced.push(path);}
  }catch(error){
    const conflicts:string[]=[];
    for(const path of replaced.reverse()){
      if(await bytes(ctx.root,path)!==desired[path]){conflicts.push(path);continue;}
      if(expected[path]===undefined)await unlink(join(ctx.root,path));else await writeFile(join(ctx.root,path),expected[path]!);
    }
    ensure(!conflicts.length,'DESIGN_ROLLBACK_CONFLICT:'+conflicts.join(','),4);throw error;
  }finally{for(const path of staged.values())await unlink(join(ctx.root,path)).catch(()=>undefined);if(acquired&&await bytes(ctx.root,marker)===owner)await unlink(join(ctx.root,marker));}
  return changed;
}
async function readPlan(path:string):Promise<{ctx:Context;plan:Plan;planPath:string}>{
  const planPath=resolve(path),sourceRoot=await realpath(dirname(planPath)),raw=object(json(await bytes(sourceRoot,relative(dirname(planPath),planPath))));
  ensure(typeof raw.bindingFile==='string'&&hex(raw.planId),'INVALID_DESIGN_PLAN');
  const ctx=await context(raw.bindingFile),expected=join(ctx.root,ctx.binding.stateDirectory,'plans',raw.planId+'.json');
  const local=await consumerPath(ctx,planPath);
  ensure(join(ctx.root,local)===expected,'DESIGN_PLAN_OUTSIDE_OWNED_STATE',4);
  const bytesValue=await bytes(ctx.root,local);ensure(bytesValue!==undefined,'DESIGN_PLAN_MISSING');
  const plan=JSON.parse(bytesValue) as Plan,{planId,...draft}=plan;
  ensure(plan.schemaVersion===1&&plan.generator==='MPFrontendDesign'&&hex(plan.candidateHash)&&sha(encode(draft))===planId,'DESIGN_PLAN_DRIFT',3);
  ensure(plan.cliVersion===cliVersion&&plan.bindingHash===ctx.bindingHash,'STALE_DESIGN_PLAN',3);
  return {ctx,plan,planPath};
}
// Normalize operating-system root aliases (/var -> /private/var) without resolving consumer
// child symlinks away: bytes() must still inspect and reject every child link.
async function consumerPath(ctx:Context,path:string):Promise<string>{
  const absolute=resolve(path);let parent=dirname(absolute);
  for(let depth=0;depth<64;depth++){
    try{if(await realpath(parent)===ctx.root){const local=relative(parent,absolute);safePath(local);return local;}}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const next=dirname(parent);if(next===parent)break;parent=next;
  }throw new DesignError('UNSAFE_DESIGN_PATH',4);
}
async function verifyEvidence(ctx:Context,plan:Plan,path:string):Promise<string>{
  const file=await consumerPath(ctx,path);ensure(file.startsWith('evidence/'),'DESIGN_EVIDENCE_LOCATION_REQUIRED',4);
  const reportBytes=await bytes(ctx.root,file),raw=object(json(reportBytes),['schemaVersion','planId','candidateHash','bindingHash','cliVersion','review','checks','tasks']);
  ensure(raw.schemaVersion===1&&raw.planId===plan.planId&&raw.candidateHash===plan.candidateHash&&raw.bindingHash===plan.bindingHash&&raw.cliVersion===cliVersion,'STALE_DESIGN_EVIDENCE',3);
  const review=object(raw.review,['approved','reviewer']);ensure(review.approved===true&&text(review.reviewer),'DESIGN_REVIEW_REQUIRED',3);
  const report=raw as unknown as Evidence;
  list(report.checks);list(report.tasks);unique(report.checks.map(c=>c.name));unique(report.tasks.map(t=>t.id));
  ensure(report.checks.every(check=>plan.checks.includes(check.name))&&report.tasks.every(task=>plan.tasks.some(t=>t.id===task.id)),'DESIGN_EVIDENCE_SCOPE_MISMATCH',3);
  const artifact=async(raw:unknown)=>{const item=object(raw,['path','sha256']);safePath(item.path);ensure(hex(item.sha256),'INVALID_DESIGN_EVIDENCE_DIGEST');const current=await rawBytes(ctx.root,item.path);ensure(current!==undefined&&createHash('sha256').update(current).digest('hex')===item.sha256,'DESIGN_EVIDENCE_ARTIFACT_DRIFT',3);};
  for(const required of plan.checks){
    const check=report.checks.find(c=>c.name===required);ensure(check&&check.passed===true&&text(check.command),'DESIGN_CHECK_NOT_PASSED:'+required,3);
    object(check,['name','passed','command','artifact']);ensure(check.artifact.path.startsWith('evidence/'),'DESIGN_CHECK_ARTIFACT_LOCATION_REQUIRED',4);await artifact(check.artifact);
  }
  for(const task of plan.tasks){
    const completed=report.tasks.find(t=>t.id===task.id);ensure(completed&&completed.status==='implemented','DESIGN_TASK_NOT_IMPLEMENTED:'+task.id,3);
    object(completed,['id','status','files']);list(completed.files);ensure(completed.files.length>0&&task.requiredFiles.every(path=>completed.files.some(file=>file.path===path)),'DESIGN_TASK_FILES_REQUIRED',3);
    unique(completed.files.map(f=>f.path));for(const file of completed.files){ensure(!file.path.startsWith(ctx.binding.stateDirectory+'/')&&!file.path.startsWith(ctx.binding.outputDirectory+'/'),'DESIGN_AUTHORED_TASK_EVIDENCE_REQUIRED',4);await artifact(file);}
  }
  return sha(reportBytes!);
}
export async function designCommand(options:DesignOptions){
  const dryRun=options.dryRun??false;
  if(options.command==='apply'||options.command==='accept'){
    ensure(options.planPath,'DESIGN_PLAN_REQUIRED');const {ctx,plan}=await readPlan(options.planPath);
    ensure(!plan.diagnostics.length,'UNRESOLVED_DESIGN_PLAN',2);
    const next=await candidate(ctx,plan.candidateHash),owned=await ownership(ctx),accepted=await baseline(ctx),desired=outputs(ctx,next);
    ensure(encode(Object.fromEntries(Object.entries(desired).map(([path,value])=>[path,sha(value)])))===encode(plan.after),'DESIGN_PLAN_OUTPUT_MISMATCH',3);
    if(options.command==='apply'){
      if(owned.value?.planId===plan.planId&&owned.value.candidateHash===plan.candidateHash){ensure(owned.value.cliVersion===cliVersion&&owned.value.bindingHash===ctx.bindingHash&&encode(owned.value.outputs)===encode(plan.after),'DESIGN_APPLIED_OUTPUT_MISMATCH',3);return {ok:true,command:'apply',dryRun,changed:[],planId:plan.planId};}
      const fresh=await buildPlan(ctx,plan.candidateHash);ensure(fresh.planId===plan.planId,'STALE_DESIGN_PLAN',3);
      const expected:Record<string,string|undefined>={};for(const path of Object.keys(desired))expected[path]=await bytes(ctx.root,path);
      const ownershipPath=ctx.binding.stateDirectory+'/ownership.json';expected[ownershipPath]=owned.bytes;
      desired[ownershipPath]=encode({schemaVersion:1,generator:'MPFrontendDesign',cliVersion,bindingHash:ctx.bindingHash,candidateHash:plan.candidateHash,planId:plan.planId,outputs:plan.after});
      return {ok:true,command:'apply',dryRun,planId:plan.planId,changed:await writeBatch(ctx,desired,expected,dryRun),unresolvedTasks:plan.tasks};
    }
    ensure(owned.value?.planId===plan.planId&&owned.value.candidateHash===plan.candidateHash&&owned.value.bindingHash===ctx.bindingHash&&owned.value.cliVersion===cliVersion&&encode(owned.value.outputs)===encode(plan.after),'DESIGN_PLAN_NOT_APPLIED',3);
    ensure(options.evidencePath,'DESIGN_EVIDENCE_REQUIRED');const evidenceHash=await verifyEvidence(ctx,plan,options.evidencePath);
    const acceptedValue:Baseline={schemaVersion:1,generator:'MPFrontendDesign',cliVersion,candidateHash:plan.candidateHash,planId:plan.planId,bindingHash:ctx.bindingHash,evidenceHash,evidencePath:await consumerPath(ctx,options.evidencePath)};
    const encoded=encode(acceptedValue),path=ctx.binding.stateDirectory+'/baseline.json';
    if(accepted.bytes===encoded)return {ok:true,command:'accept',dryRun,changed:[],candidateHash:plan.candidateHash};
    ensure((accepted.bytes===undefined?null:sha(accepted.bytes))===plan.baselineHash,'STALE_DESIGN_BASELINE',3);
    return {ok:true,command:'accept',dryRun,candidateHash:plan.candidateHash,changed:await writeBatch(ctx,{[path]:encoded},{[path]:accepted.bytes},dryRun)};
  }
  ensure(options.bindingPath,'DESIGN_BINDING_REQUIRED');const ctx=await context(options.bindingPath);
  if(options.command==='import'){
    ensure(options.snapshotPath,'DESIGN_SNAPSHOT_REQUIRED');
    const source=resolve(options.snapshotPath),sourceRoot=await realpath(dirname(source));
    const snapshot=parseSnapshot(json(await bytes(sourceRoot,relative(dirname(source),source))));
    ensure(encode({fileKey:snapshot.source.fileKey,nodeId:snapshot.source.nodeId})===encode(ctx.binding.source),'DESIGN_SOURCE_MISMATCH');
    const content=encode(snapshot),hash=sha(content),path=ctx.binding.stateDirectory+'/snapshots/'+hash+'.json',old=await bytes(ctx.root,path);
    ensure(old===undefined||old===content,'IMMUTABLE_DESIGN_CANDIDATE_DRIFT',3);
    return {ok:true,command:'import',dryRun,candidateHash:hash,sourceRevision:snapshot.source.revision,diagnostics:diagnostics(ctx.binding,snapshot),changed:await writeBatch(ctx,{[path]:content},{[path]:old},dryRun)};
  }
  if(options.command==='check'){
    const accepted=await baseline(ctx),owned=await ownership(ctx);ensure(accepted.value&&owned.value,'DESIGN_BASELINE_NOT_ACCEPTED',3);
    ensure(accepted.value.cliVersion===cliVersion&&accepted.value.bindingHash===ctx.bindingHash&&owned.value.candidateHash===accepted.value.candidateHash&&owned.value.planId===accepted.value.planId,'DESIGN_BASELINE_OR_BINDING_DRIFT',3);
    const wanted=outputs(ctx,accepted.snapshot!);ensure(encode(Object.fromEntries(Object.entries(wanted).map(([path,value])=>[path,sha(value)])))===encode(owned.value.outputs),'DESIGN_ACCEPTED_OUTPUT_DRIFT',3);
    const reviewed=await readPlan(join(ctx.root,ctx.binding.stateDirectory,'plans',accepted.value.planId+'.json'));
    ensure(await verifyEvidence(ctx,reviewed.plan,join(ctx.root,accepted.value.evidencePath))===accepted.value.evidenceHash,'DESIGN_ACCEPTED_EVIDENCE_DRIFT',3);
    return {ok:true,command:'check',scope:'declared-export-only',candidateHash:accepted.value.candidateHash,sourceRevision:accepted.snapshot!.source.revision,checked:Object.keys(wanted).length};
  }
  ensure(['validate','diff','plan'].includes(options.command),'UNKNOWN_DESIGN_COMMAND');ensure(options.candidate,'DESIGN_CANDIDATE_REQUIRED');
  const snapshot=await candidate(ctx,options.candidate);
  if(options.command==='validate'){const issues=diagnostics(ctx.binding,snapshot);ensure(!issues.length,'INVALID_DESIGN_MAPPING:'+issues.join(','));return {ok:true,command:'validate',candidateHash:options.candidate,sourceRevision:snapshot.source.revision};}
  if(options.command==='diff')return {ok:true,command:'diff',candidateHash:options.candidate,changes:changes((await baseline(ctx)).snapshot,snapshot),diagnostics:diagnostics(ctx.binding,snapshot)};
  const plan=await buildPlan(ctx,options.candidate),path=ctx.binding.stateDirectory+'/plans/'+plan.planId+'.json',old=await bytes(ctx.root,path),content=encode(plan);
  ensure(old===undefined||old===content,'IMMUTABLE_DESIGN_PLAN_DRIFT',3);
  return {ok:true,command:'plan',dryRun,plan,planPath:join(ctx.root,path),changed:await writeBatch(ctx,{[path]:content},{[path]:old},dryRun)};
}
