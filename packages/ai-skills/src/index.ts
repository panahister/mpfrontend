import {readFile,lstat,realpath,mkdir,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

export const SKILLS_VERSION='0.1.0-dev.11',SKILLS_CLI_VERSION='0.1.0-dev.18';
const names=['scaffold-app','implement-feature','integrate-openapi','form-from-api','table-from-api',
  'integrate-auth','apply-access','use-ui','configure-i18n','configure-theme','integrate-realtime',
  'verify-frontend','upgrade-project','prepare-release','import-design-system','sync-design-tokens',
  'reconcile-design-components','review-design-drift'] as const;
const available=new Set(names);
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export class SkillsError extends Error{constructor(message:string,readonly exitCode=4){super(message);}}
export function skillCatalog(){return {version:SKILLS_VERSION,cliVersion:SKILLS_CLI_VERSION,skills:names.map((name,index)=>({
  name:'mpfrontend-'+name,profile:index<14?'base':'design',available:available.has(name),
  ...(available.has(name)?{}:{reason:'CAPABILITY_AND_BEHAVIORAL_ACCEPTANCE_PENDING'})
}))};}
type Lock={generator:'MPFrontendSkills';schemaVersion:1;version:string;cliVersion:string;
  profile:'base'|'design';agents:Array<'codex'|'claude'>;files:Record<string,string>};
type Options={directory:string;profile?:'base'|'design';agent?:'codex'|'claude'|'both';dryRun?:boolean;update?:boolean};
const lockPath='.mpfrontend/skills-lock.json';
const mutexPath='.mpfrontend/skills-install.lock';
async function content(root:string,path:string):Promise<string|undefined>{
  let current=root;
  for(const part of path.split('/')){
    current=join(current,part);
    try{const info=await lstat(current);if(info.isSymbolicLink())throw new SkillsError('SKILL_PATH_SYMLINK');
      if(current!==join(root,path)&&!info.isDirectory())throw new SkillsError('SKILL_PARENT_NOT_DIRECTORY');
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  }
  try{return await readFile(current,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
function parseLock(bytes:string|undefined):Lock|undefined{
  if(bytes===undefined)return undefined;
  try{
    const value=JSON.parse(bytes) as Lock;
    if(value.generator!=='MPFrontendSkills'||value.schemaVersion!==1||typeof value.version!=='string'||typeof value.cliVersion!=='string'||!['base','design'].includes(value.profile)||!Array.isArray(value.agents)||!value.agents.length||value.agents.length>2||new Set(value.agents).size!==value.agents.length||value.agents.some(v=>!['codex','claude'].includes(v))||!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw new Error();
    for(const [path,digest]of Object.entries(value.files))if(!/^\.(?:agents|claude)\/skills\/mpfrontend-[a-z0-9-]+\/SKILL\.md$/.test(path)||!/^([a-f0-9]{64})$/.test(digest))throw new Error();
    return value;
  }catch{throw new SkillsError('INVALID_SKILLS_LOCK');}
}
/**
 * The `mpfrontend-` prefix is reserved for the catalog. A consumer's own project and domain skills live
 * beside the installed ones under another prefix; the installer never reads, changes or removes them.
 */
async function refuseReservedNames(root:string){
  const catalog=new Set(names.map(name=>'mpfrontend-'+name));
  for(const base of ['.agents/skills','.claude/skills']){
    const parent=join(root,base);
    try{if(!(await lstat(parent)).isDirectory())continue;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
    for(const entry of await readdir(parent))if(entry.startsWith('mpfrontend-')&&!catalog.has(entry))throw new SkillsError('RESERVED_SKILL_NAME:'+base+'/'+entry,3);
  }
}
export async function installSkills(options:Options){
  const profile=options.profile??'base',agent=options.agent??'both';
  if(!['base','design'].includes(profile)||!['codex','claude','both'].includes(agent))throw new SkillsError('INVALID_SKILL_PROFILE_OR_AGENT',2);
  const root=await realpath(resolve(options.directory)),previousLock=await content(root,lockPath),lock=parseLock(previousLock);
  if(await content(root,mutexPath)!==undefined)throw new SkillsError('SKILLS_INSTALL_BUSY');
  if(options.update&&!lock)throw new SkillsError('SKILLS_NOT_INSTALLED',2);
  // Updates preserve the installed selection unless the caller explicitly changes it.
  const selectedProfile=options.profile??lock?.profile??profile;
  const agents:Array<'codex'|'claude'>=options.agent?(agent==='both'?['codex','claude']:[agent]):lock?.agents??['codex','claude'];
  const catalog=skillCatalog(),selected=catalog.skills.filter(s=>selectedProfile==='design'||s.profile==='base');
  const desired=new Map<string,string>(),before=new Map<string,string|undefined>();
  const files={...lock?.files};
  for(const skill of selected.filter(s=>s.available)){
    const source=await readFile(new URL('../skills/'+skill.name+'/SKILL.md',import.meta.url),'utf8');
    for(const target of agents){
      const path=(target==='codex'?'.agents':'.claude')+'/skills/'+skill.name+'/SKILL.md';
      const old=await content(root,path);
      if(old!==undefined&&(!lock?.files[path]||hash(old)!==lock.files[path]))throw new SkillsError('MODIFIED_OR_UNOWNED_SKILL:'+path);
      before.set(path,old);files[path]=hash(source);if(old!==source)desired.set(path,source);
    }
  }
  await refuseReservedNames(root);
  const next:Lock={generator:'MPFrontendSkills',schemaVersion:1,version:SKILLS_VERSION,cliVersion:SKILLS_CLI_VERSION,profile:selectedProfile,agents,files};
  const encoded=JSON.stringify(next,null,2)+'\n';before.set(lockPath,previousLock);if(previousLock!==encoded)desired.set(lockPath,encoded);
  const changes=[...desired].map(([path,text])=>({path,beforeHash:before.get(path)===undefined?null:hash(before.get(path)!),afterHash:hash(text)}));
  if(!options.dryRun){
    const staged=new Map<string,string>(),replaced:string[]=[];
    const owner=randomUUID();let acquired=false;
    try{
      await mkdir(join(root,'.mpfrontend'),{recursive:true});await content(root,mutexPath);
      try{await writeFile(join(root,mutexPath),owner,{flag:'wx'});acquired=true;}
      catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new SkillsError('SKILLS_INSTALL_BUSY');throw error;}
      for(const [path,text]of desired){
        if(await content(root,path)!==before.get(path))throw new SkillsError('CONCURRENT_SKILL_EDIT:'+path);
        await mkdir(dirname(join(root,path)),{recursive:true});
        const stage=join(dirname(join(root,path)),'.mpfrontend-'+randomUUID());await writeFile(stage,text,{flag:'wx'});staged.set(path,stage);
      }
      // Lock is written last. No AGENTS.md, CLAUDE.md or unrelated skill is altered.
      for(const [path,stage]of staged){
        const current=await content(root,path);if(current!==before.get(path))throw new SkillsError('CONCURRENT_SKILL_EDIT:'+path);
        await rename(stage,join(root,path));staged.delete(path);replaced.push(path);
      }
    }catch(error){
      const conflicts:string[]=[];
      for(const path of replaced.reverse()){
        // A second agent's edit is never overwritten by rollback, even on a failed install.
        if(await content(root,path)!==desired.get(path)){conflicts.push(path);continue;}
        const old=before.get(path);if(old===undefined)await unlink(join(root,path));else await writeFile(join(root,path),old);
      }
      if(conflicts.length)throw new SkillsError('SKILL_ROLLBACK_CONFLICT:'+conflicts.join(','));
      throw error;
    }finally{
      for(const path of staged.values())await unlink(path).catch(()=>undefined);
      if(acquired&&await content(root,mutexPath)===owner)await unlink(join(root,mutexPath));
    }
  }
  return {ok:true,version:SKILLS_VERSION,profile:selectedProfile,agents,dryRun:options.dryRun??false,changes,
    installed:selected.filter(s=>s.available).map(s=>s.name),unavailable:selected.filter(s=>!s.available)};
}
export async function checkSkills(directory:string){
  const root=await realpath(resolve(directory));
  if(await content(root,mutexPath)!==undefined)throw new SkillsError('SKILLS_INSTALL_BUSY');
  const lock=parseLock(await content(root,lockPath));
  if(!lock)throw new SkillsError('SKILLS_NOT_INSTALLED',2);
  if(lock.version!==SKILLS_VERSION||lock.cliVersion!==SKILLS_CLI_VERSION)throw new SkillsError('SKILLS_VERSION_MISMATCH',3);
  await refuseReservedNames(root);
  const catalog=skillCatalog();let checked=0;
  for(const skill of catalog.skills.filter(s=>s.available&&(lock.profile==='design'||s.profile==='base')))for(const agent of lock.agents){
    const path=(agent==='codex'?'.agents':'.claude')+'/skills/'+skill.name+'/SKILL.md';
    if(!lock.files[path])throw new SkillsError('INCOMPLETE_SKILLS_LOCK:'+path,3);
  }
  for(const [path,digest]of Object.entries(lock.files)){
    const old=await content(root,path);if(old===undefined||hash(old)!==digest)throw new SkillsError('INSTALLED_SKILL_DRIFT:'+path,3);
    const name=path.split('/')[2]!,skill=catalog.skills.find(s=>s.name===name);
    if(!skill?.available)throw new SkillsError('UNAVAILABLE_INSTALLED_SKILL:'+name,3);
    const source=await readFile(new URL('../skills/'+name+'/SKILL.md',import.meta.url),'utf8');
    if(hash(source)!==digest)throw new SkillsError('SKILLS_SOURCE_DRIFT:'+name,3);checked++;
  }
  if(!checked)throw new SkillsError('EMPTY_SKILLS_LOCK',3);
  return {ok:true,version:SKILLS_VERSION,checked,agents:lock.agents};
}
