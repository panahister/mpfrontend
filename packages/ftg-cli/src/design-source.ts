import {randomUUID} from 'node:crypto';
import {lstat,mkdir,readFile,rename,unlink,writeFile} from 'node:fs/promises';
import {isAbsolute,join,relative,resolve} from 'node:path';
import {DesignError,inspectDesignBinding} from './design.js';

type SourceMode='none'|'existing';
type SourceConfig={schemaVersion:1;generator:'MPFrontendDesignSource';cliVersion:string;source:SourceMode;
  status:'disabled'|'pending'|'attached';binding:string|null;bindingHash:string|null;sourceIdentity:null;release:null};
export type DesignSourceOptions={command:'attach'|'status';directory:string;source?:SourceMode;bindingPath?:string;dryRun?:boolean;cliVersion:string};
const configPath='.mpfrontend/design-source.json',lockPath='.mpfrontend/design-source.lock';
const encode=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
function ensure(value:unknown,message:string,code=2):asserts value{if(!value)throw new DesignError(message,code);}
const record=(value:unknown,message='INVALID_DESIGN_SOURCE_CONFIG'):Record<string,unknown>=>{
  ensure(value!==null&&typeof value==='object'&&!Array.isArray(value),message);
  const result=value as Record<string,unknown>;ensure(Object.keys(result).every(key=>!['__proto__','prototype','constructor'].includes(key)),'UNSAFE_DESIGN_SOURCE_KEY',4);return result;
};
function exact(value:Record<string,unknown>,keys:string[],message:string){ensure(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)),message);}
function safeRelative(value:string){
  ensure(!isAbsolute(value)&&value.length>0&&value.length<=500&&/^[a-zA-Z0-9_./@-]+$/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!['.git','.aws','.codex','.agents','.claude','node_modules'].includes(part)),'UNSAFE_DESIGN_SOURCE_PATH',4);
}
async function file(root:string,path:string,required=true):Promise<Buffer|undefined>{
  safeRelative(path);let current=root;
  for(const part of path.split('/')){
    current=join(current,part);
    try{const info=await lstat(current);ensure(!info.isSymbolicLink(),'DESIGN_SOURCE_PATH_SYMLINK',4);
      ensure(current===join(root,path)?info.isFile():info.isDirectory(),'DESIGN_SOURCE_PATH_KIND',4);
      if(current===join(root,path))ensure(info.size<=5*1024*1024,'DESIGN_SOURCE_FILE_TOO_LARGE',4);
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){ensure(!required,'DESIGN_SOURCE_FILE_MISSING');return undefined;}throw error;}
  }
  const result=await readFile(current);ensure(result.length<=5*1024*1024,'DESIGN_SOURCE_FILE_TOO_LARGE',4);return result;
}
function json(bytes:Buffer|undefined,message:string):unknown{ensure(bytes,message);try{return JSON.parse(bytes.toString('utf8'));}catch{throw new DesignError(message);}}
function parseConfig(raw:unknown):SourceConfig{
  const value=record(raw);exact(value,['schemaVersion','generator','cliVersion','source','status','binding','bindingHash','sourceIdentity','release'],'INVALID_DESIGN_SOURCE_CONFIG');
  ensure(value.schemaVersion===1&&value.generator==='MPFrontendDesignSource'&&typeof value.cliVersion==='string'&&['none','existing'].includes(String(value.source))&&['disabled','pending','attached'].includes(String(value.status)),'INVALID_DESIGN_SOURCE_CONFIG');
  ensure(value.binding===null||typeof value.binding==='string','INVALID_DESIGN_SOURCE_CONFIG');if(typeof value.binding==='string')safeRelative(value.binding);
  ensure(value.bindingHash===null||typeof value.bindingHash==='string'&&/^[a-f0-9]{64}$/.test(value.bindingHash),'INVALID_DESIGN_SOURCE_CONFIG');
  ensure(value.sourceIdentity===null&&value.release===null,'INVALID_DESIGN_SOURCE_CONFIG');
  return value as unknown as SourceConfig;
}
async function rootFor(directory:string){
  const root=resolve(directory),info=await lstat(root).catch(()=>undefined);ensure(info?.isDirectory()&&!info.isSymbolicLink(),'DESIGN_WORKSPACE_REQUIRED',4);
  for(const marker of ['package.json','nx.json','pnpm-workspace.yaml'])await file(root,marker);
  return root;
}
async function localFile(root:string,input:string){
  ensure(!isAbsolute(input),'UNSAFE_DESIGN_SOURCE_PATH',4);const path=relative(root,resolve(root,input));safeRelative(path);await file(root,path);return path;
}
async function readConfig(root:string){const bytes=await file(root,configPath,false);return {bytes,value:bytes?parseConfig(json(bytes,'INVALID_DESIGN_SOURCE_CONFIG')):undefined};}
async function verifyAttached(root:string,value:SourceConfig){
  if(value.source==='none'){ensure(value.status==='disabled'&&value.binding===null&&value.bindingHash===null&&value.sourceIdentity===null&&value.release===null,'INVALID_DESIGN_SOURCE_CONFIG');return {bindingHash:null,releaseVersion:null};}
  ensure(value.status==='attached'&&value.binding&&value.bindingHash,'DESIGN_SOURCE_NOT_ATTACHED',3);
  const binding=await inspectDesignBinding(join(root,value.binding));ensure(binding.bindingHash===value.bindingHash,'DESIGN_BINDING_DRIFT',3);
  ensure(value.sourceIdentity===null&&value.release===null,'INVALID_DESIGN_SOURCE_CONFIG');
  return {bindingHash:binding.bindingHash,releaseVersion:null};
}
async function writeConfig(root:string,content:string,expected:Buffer|undefined,dryRun:boolean){
  if(dryRun)return expected?.toString('utf8')===content?[]:[configPath];
  await mkdir(join(root,'.mpfrontend'),{recursive:true});const owner=randomUUID();let acquired=false,stage='';
  try{
    await file(root,lockPath,false);try{await writeFile(join(root,lockPath),owner,{flag:'wx'});acquired=true;}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new DesignError('DESIGN_SOURCE_BUSY',4);throw error;}
    const current=await file(root,configPath,false);ensure((current?.toString('utf8')??null)===(expected?.toString('utf8')??null),'CONCURRENT_DESIGN_SOURCE_EDIT',4);
    if(current?.toString('utf8')===content)return [];
    stage=join(root,'.mpfrontend','.design-source-'+randomUUID());await writeFile(stage,content,{flag:'wx'});await rename(stage,join(root,configPath));stage='';return [configPath];
  }finally{if(stage)await unlink(stage).catch(()=>undefined);if(acquired&&(await file(root,lockPath,false))?.toString('utf8')===owner)await unlink(join(root,lockPath));}
}
export async function designSourceCommand(options:DesignSourceOptions){
  const root=await rootFor(options.directory),current=await readConfig(root);
  if(options.command==='status'){
    ensure(current.value,'DESIGN_SOURCE_NOT_CONFIGURED',3);const verification=current.value.status==='pending'?{bindingHash:null,releaseVersion:null}:await verifyAttached(root,current.value);
    return {ok:true,command:'status',source:current.value.source,status:current.value.status,binding:current.value.binding,...verification};
  }
  ensure(options.source==='existing','ATTACHABLE_DESIGN_SOURCE_REQUIRED');
  ensure(options.bindingPath,'DESIGN_BINDING_REQUIRED');const bindingPath=await localFile(root,options.bindingPath),binding=await inspectDesignBinding(join(root,bindingPath));
  if(current.value){
    ensure(current.value.status!=='attached'||current.value.source===options.source&&current.value.binding===bindingPath&&current.value.bindingHash===binding.bindingHash,'DESIGN_SOURCE_ALREADY_ATTACHED',4);
    ensure(current.value.source==='none'||current.value.source===options.source,'DESIGN_SOURCE_MODE_MISMATCH',4);
  }
  const next:SourceConfig={schemaVersion:1,generator:'MPFrontendDesignSource',cliVersion:options.cliVersion,source:options.source,status:'attached',binding:bindingPath,bindingHash:binding.bindingHash,sourceIdentity:null,release:null};
  const content=encode(next);ensure(current.value?.status!=='attached'||current.bytes?.toString('utf8')===content,'DESIGN_SOURCE_ALREADY_ATTACHED',4);
  const changed=await writeConfig(root,content,current.bytes,options.dryRun??false);
  return {ok:true,command:'attach',source:options.source,status:'attached',binding:bindingPath,bindingHash:binding.bindingHash,releaseVersion:null,dryRun:options.dryRun??false,changed};
}
