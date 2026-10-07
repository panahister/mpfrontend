import { readFile, readdir, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export {createWorkspace,workspaceFiles,type DesignSource,type WorkspaceOptions} from './workspace.js';
export type ApplicationOptions={name:string;directory:string;dryRun?:boolean};
export async function applicationFiles(name:string):Promise<Record<string,string>>{
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(name))throw new Error('INVALID_APP_NAME');
  const root=fileURLToPath(new URL('../templates/next/',import.meta.url));
  const result:Record<string,string>={};
  async function visit(dir:string,prefix:string){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,entry.name),key=prefix+entry.name;
      if(entry.isDirectory())await visit(path,key+'/');
      else result[key.replace(/\.template$/,'')]=(await readFile(path,'utf8')).replaceAll('__APP_NAME__',name);
    }
  }
  await visit(root,'');return result;
}
export async function createApplication(options:ApplicationOptions){
  const directory=resolve(options.directory);
  try {await lstat(directory);throw new Error('DESTINATION_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const files=await applicationFiles(options.name);
  if(!options.dryRun){await mkdir(directory,{recursive:false});for(const[path,content]of Object.entries(files)){const target=join(directory,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}}
  return {ok:true,name:options.name,files:Object.keys(files).sort(),dryRun:options.dryRun===true};
}
