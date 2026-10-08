import {readFile,readdir,lstat,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Lower-case kebab names: apps, features, resources and packages. */
export const NAME_PATTERN=/^[a-z][a-z0-9-]{1,48}$/;
export const pascal=(name:string)=>name.split('-').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join('');
export const constant=(name:string)=>name.replaceAll('-','_').toUpperCase();
export type Replacements=Readonly<Record<string,string>>;

/** Reads a template folder; placeholders are replaced in file paths and contents, `.template` is dropped. */
export async function templateFiles(folder:string,replacements:Replacements):Promise<Record<string,string>>{
  const root=fileURLToPath(new URL('../templates/'+folder+'/',import.meta.url));
  const apply=(text:string)=>Object.entries(replacements).reduce((value,[key,replacement])=>value.replaceAll(key,replacement),text);
  const result:Record<string,string>={};
  async function visit(dir:string,prefix:string){
    for(const entry of await readdir(dir,{withFileTypes:true})){
      const path=join(dir,entry.name),key=prefix+entry.name;
      if(entry.isDirectory())await visit(path,key+'/');
      else result[apply(key.replace(/\.template$/,''))]=apply(await readFile(path,'utf8'));
    }
  }
  await visit(root,'');
  return result;
}

/** A POSIX import specifier from one source directory to another. */
export function importPath(fromDirectory:string,toPath:string):string{
  const path=relative(fromDirectory,toPath).split(sep).join('/');
  return path.startsWith('.')?path:'./'+path;
}

/** A workspace-relative directory without traversal, absolute paths or backslashes. */
export function safeRelative(path:string,error:string):string{
  const parts=path.split('/');
  if(!path||isAbsolute(path)||path.includes('\\')||parts.some(part=>part===''||part==='.'||part==='..'))throw new Error(error);
  return parts.join('/');
}

export async function exists(path:string):Promise<boolean>{
  try{await lstat(path);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}

/** Formats one file's content; `path` is the absolute path the file will be written to. */
export type Formatter=(path:string,content:string)=>Promise<string>;

/**
 * The workspace formatter, when the workspace has one: Prettier resolved from the workspace root with the
 * workspace's own configuration. Without it, files are written exactly as the templates hold them.
 */
export async function workspaceFormatter(root:string):Promise<Formatter|undefined>{
  let entry:string;
  try{entry=createRequire(join(root,'package.json')).resolve('prettier');}catch{return undefined;}
  const loaded=await import(entry) as {default?:unknown};
  const prettier=(loaded.default??loaded) as {resolveConfig:(path:string)=>Promise<object|null>;getFileInfo:(path:string,options:object)=>Promise<{inferredParser:string|null}>;format:(text:string,options:object)=>Promise<string>};
  return async (path,content)=>{
    // The parser comes from the file name; ignore files do not apply to output the generator is writing.
    if(!(await prettier.getFileInfo(path,{withNodeModules:true})).inferredParser)return content;
    return prettier.format(content,{...(await prettier.resolveConfig(path)),filepath:path});
  };
}

/** Formats the files and writes them with exclusive creation; an existing file is never replaced. */
export async function writeNew(root:string,files:Record<string,string>,formatter?:Formatter):Promise<boolean>{
  const output:Array<[string,string]>=[];
  for(const [path,content] of Object.entries(files)){
    const target=resolve(root,path);
    output.push([target,formatter?await formatter(target,content):content]);
  }
  for(const [target,content] of output){
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,content,{flag:'wx'});
  }
  return formatter!==undefined;
}
