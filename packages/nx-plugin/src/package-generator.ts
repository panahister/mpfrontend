import { formatFiles, type Tree } from '@nx/devkit';
import { planPackage, type PackageRuntime } from './scaffold.js';
import { treeReader, writeTree } from './nx-tree.js';
/** `nx g @mpfrontend/nx-plugin:package`: the same files as `mpfrontend create package`. */
export default async function packageGenerator(tree:Tree,options:{name:string;directory?:string;runtime?:PackageRuntime}){
  writeTree(tree,(await planPackage(treeReader(tree),options)).files);
  await formatFiles(tree);
}
