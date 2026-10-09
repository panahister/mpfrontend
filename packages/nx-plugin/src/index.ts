import { mkdir, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { templateFiles, workspaceFormatter, writeNew, type Formatter } from './templates.js';
import { featureFiles, routeFiles } from './scaffold.js';
export {createWorkspace,workspaceFiles,type DesignSource,type WorkspaceOptions} from './workspace.js';
export {featureFiles,routeFiles,packageFiles,planFeature,planRoute,planPackage,createFeature,createRoute,createPackage,diskReader,
  type FeatureKind,type FeatureRequest,type RouteRequest,type PackageRequest,type PackageRuntime,type CreateOptions,type Plan,type WorkspaceReader} from './scaffold.js';
export {workspaceFormatter,type Formatter} from './templates.js';
export type ApplicationOptions={name:string;directory:string;dryRun?:boolean;formatter?:Formatter};
/** Names only: values are deployment configuration and never belong in the repository. */
const envExample='# Environment variables this app reads. Supply values from the deployment, never from this file.\nBFF_ORIGIN=\nBFF_SESSION_COOKIE=\nENABLE_API_DOCS=\n';
/**
 * The application template. Its catalog example is produced by the feature generator (a list feature over
 * the generated `catalog` read) and its two screens by the route generator: one list route and one detail route.
 */
export async function applicationFiles(name:string):Promise<Record<string,string>>{
  if(!/^[a-z][a-z0-9-]{1,48}$/.test(name))throw new Error('INVALID_APP_NAME');
  // The template's own files come last; its example feature is used exactly as generated.
  return {
    ...await featureFiles('catalog',{resource:'catalog',generatedOutput:'src/api/generated/catalog'}),
    ...routeFiles('catalog','catalog','CatalogScreen'),
    ...routeFiles('catalog/[position]','catalog','CatalogDetailScreen'),
    ...await templateFiles('next',{__APP_NAME__:name}),
    '.env.example':envExample,
  };
}
export async function createApplication(options:ApplicationOptions){
  const directory=resolve(options.directory);
  try {await lstat(directory);throw new Error('DESTINATION_EXISTS');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const files=await applicationFiles(options.name);
  let formatted=false;
  if(!options.dryRun){
    // Exclusive creation of the app directory refuses a competing creator; files are formatted by the
    // workspace formatter found above the new app, when there is one.
    await mkdir(directory,{recursive:false});
    formatted=await writeNew(directory,files,options.formatter??await workspaceFormatter(dirname(dirname(directory))));
  }
  return {ok:true,name:options.name,files:Object.keys(files).sort(),dryRun:options.dryRun===true,formatted};
}
