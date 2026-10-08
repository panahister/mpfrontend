import type { Tree } from '@nx/devkit';
import type { WorkspaceReader } from './scaffold.js';
export function treeReader(tree:Tree):WorkspaceReader{
  return {exists:async path=>tree.exists(path),read:async path=>tree.exists(path)?tree.read(path,'utf-8')??undefined:undefined};
}
/** Writes only new files; an existing file in the tree is a collision, never an overwrite. */
export function writeTree(tree:Tree,files:Record<string,string>){
  for(const path of Object.keys(files))if(tree.exists(path))throw new Error('DESTINATION_EXISTS');
  for(const [path,content] of Object.entries(files))tree.write(path,content);
}
