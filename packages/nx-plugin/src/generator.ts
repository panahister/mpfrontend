import type { Tree } from '@nx/devkit';
import { applicationFiles } from './index.js';
export default async function applicationGenerator(tree:Tree,options:{name:string;directory:string}){
  if(!options.directory || options.directory.startsWith('/') || options.directory.split('/').includes('..'))throw new Error('INVALID_DIRECTORY');
  const files=await applicationFiles(options.name);
  if(Object.keys(files).some(path=>tree.exists(options.directory+'/'+path)))throw new Error('DESTINATION_EXISTS');
  for(const[path,content]of Object.entries(files))tree.write(options.directory+'/'+path,content);
}
