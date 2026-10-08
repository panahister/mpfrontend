import {readdir,readFile} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkCatalogs,type Catalog,type CatalogProblem} from '@mpfrontend/i18n';
import {InputError} from './index.js';

type Registry={locales:readonly string[];defaultLocale:string};
type CatalogSet={path:string;scope:string;locales:Record<string,string>};
const sourceFile=/\.(?:ts|tsx|mts|cts|js|jsx|mjs)$/;
const testFile=/\.test\.[a-z]+$/;
const literal=/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;

/** Every directory named `messages` under `src`, and every source file outside them; links are not followed. */
async function walk(root:string,directory:string,sets:CatalogSet[],sources:string[]){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){
      if(entry.name==='generated'||entry.name==='node_modules')continue;
      if(entry.name==='messages'){
        const locales:Record<string,string>={};
        for(const file of await readdir(path,{withFileTypes:true}))if(file.isFile()&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.ts$/.test(file.name))locales[file.name.slice(0,-3)]=join(path,file.name);
        // A feature's or an entity's catalog is used within that unit; the app catalog anywhere in src.
        const parts=relative(root,path).split(sep);
        const unit=parts[0]==='features'||parts[0]==='entities'?join(root,parts[0],parts[1]!):root;
        sets.push({path,scope:unit,locales});
      }else await walk(root,path,sets,sources);
    }else if(entry.isFile()&&sourceFile.test(entry.name)&&!testFile.test(entry.name))sources.push(path);
  }
}

/**
 * Checks every catalog set of an app against its locale registry: each registry locale has a catalog, each
 * catalog has exactly the base keys, every message parses and takes the base parameters, and code uses
 * every key. The registry is `localeRegistry` of `src/config/app.ts`; catalogs are the default exports of
 * `messages/<locale>.ts` files, read with Node's TypeScript type stripping.
 */
export async function catalogCheck(appDirectory:string){
  const app=resolve(appDirectory),src=join(app,'src');
  let registry:Registry|undefined;
  try{registry=(await import(pathToFileURL(join(src,'config/app.ts')).href) as {localeRegistry?:Registry}).localeRegistry;}catch{registry=undefined;}
  if(!registry||!Array.isArray(registry.locales)||typeof registry.defaultLocale!=='string')throw new InputError('LOCALE_REGISTRY_UNREADABLE');
  const sets:CatalogSet[]=[],sources:string[]=[];
  await walk(src,src,sets,sources);
  const literals=new Map<string,Set<string>>();
  for(const file of sources){
    const values=new Set<string>();
    for(const match of (await readFile(file,'utf8')).matchAll(literal))if(!match[2]!.includes('${'))values.add(match[2]!);
    literals.set(file,values);
  }
  const problems:Array<CatalogProblem&{catalog:string}>=[];
  let keys=0;
  for(const set of sets){
    const catalogs:Record<string,Catalog|undefined>={};
    for(const [code,file] of Object.entries(set.locales)){
      if(!registry.locales.includes(code)){problems.push({catalog:relative(app,set.path),code:'UNKNOWN_LOCALE',locale:code});continue;}
      try{
        const value=(await import(pathToFileURL(file).href) as {default?:unknown}).default;
        if(!value||typeof value!=='object'||Object.values(value).some(message=>typeof message!=='string'))throw new Error();
        catalogs[code]=value as Catalog;
      }catch{problems.push({catalog:relative(app,set.path),code:'INVALID_MESSAGE',locale:code});}
    }
    const used=new Set<string>();
    for(const [file,values] of literals)if(file.startsWith(set.scope+sep))for(const value of values)used.add(value);
    keys+=Object.keys(catalogs[registry.defaultLocale]??{}).length;
    for(const problem of checkCatalogs({defaultLocale:registry.defaultLocale,locales:registry.locales,catalogs,isUsed:key=>used.has(key)}))problems.push({catalog:relative(app,set.path),...problem});
  }
  return {ok:problems.length===0,locales:registry.locales,defaultLocale:registry.defaultLocale,catalogs:sets.map(set=>relative(app,set.path)).sort(),keys,problems};
}
