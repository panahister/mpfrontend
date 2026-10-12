import {readdir} from 'node:fs/promises';
import {join} from 'node:path';

const PAGE=/^page\.(?:tsx|ts|jsx|js|mdx)$/;
/**
 * The page routes of a Next.js app folder, for a test of the page manifest: `/orders`, `/orders/[position]`.
 * Route groups `(name)` add no segment; private folders `_name`, parallel slots `@name` and their pages are skipped.
 */
export async function appRoutes(appDirectory:string):Promise<string[]>{
  const routes:string[]=[];
  const visit=async(directory:string,segments:readonly string[])=>{
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.isDirectory()){
        if(entry.name.startsWith('_')||entry.name.startsWith('@'))continue;
        await visit(join(directory,entry.name),/^\(.*\)$/.test(entry.name)?segments:[...segments,entry.name]);
      }else if(PAGE.test(entry.name))routes.push('/'+segments.join('/'));
    }
  };
  await visit(appDirectory,[]);
  return [...new Set(routes)].sort();
}
