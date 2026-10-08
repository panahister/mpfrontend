import { formatFiles, type Tree } from '@nx/devkit';
import { planFeature } from './scaffold.js';
import { treeReader, writeTree } from './nx-tree.js';
/** `nx g @mpfrontend/nx-plugin:feature`: the same files as `mpfrontend create feature`. */
export default async function featureGenerator(tree:Tree,options:{app:string;name:string;resource?:string}){
  writeTree(tree,(await planFeature(treeReader(tree),options)).files);
  await formatFiles(tree);
}
