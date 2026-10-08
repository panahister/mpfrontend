import { formatFiles, type Tree } from '@nx/devkit';
import { applicationFiles } from './index.js';
import { writeTree } from './nx-tree.js';
/** `nx g @mpfrontend/nx-plugin:application`: the same files as `mpfrontend create app`. */
export default async function applicationGenerator(tree:Tree,options:{name:string;directory:string}){
  if(!options.directory || options.directory.startsWith('/') || options.directory.split('/').includes('..'))throw new Error('INVALID_DIRECTORY');
  const files=await applicationFiles(options.name);
  if(tree.exists(options.directory)||Object.keys(files).some(path=>tree.exists(options.directory+'/'+path)))throw new Error('DESTINATION_EXISTS');
  writeTree(tree,Object.fromEntries(Object.entries(files).map(([path,content])=>[options.directory+'/'+path,content])));
  await formatFiles(tree);
}
