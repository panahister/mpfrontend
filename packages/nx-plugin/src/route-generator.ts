import { formatFiles, type Tree } from '@nx/devkit';
import { planRoute } from './scaffold.js';
import { treeReader, writeTree } from './nx-tree.js';
/** `nx g @mpfrontend/nx-plugin:route`: the same file as `mpfrontend create route`. */
export default async function routeGenerator(tree:Tree,options:{app:string;path:string;feature:string;screen?:string}){
  writeTree(tree,(await planRoute(treeReader(tree),options)).files);
  await formatFiles(tree);
}
