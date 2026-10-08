import {readFile} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {NAME_PATTERN,constant,exists,importPath,pascal,safeRelative,templateFiles,workspaceFormatter,writeNew,type Formatter} from './templates.js';

/** Read access to a workspace: the disk for the CLI, the Nx tree for Nx generators. Paths are workspace-relative. */
export type WorkspaceReader=Readonly<{exists:(path:string)=>Promise<boolean>;read:(path:string)=>Promise<string|undefined>}>;
export function diskReader(root:string):WorkspaceReader{
  return {
    exists:path=>exists(resolve(root,path)),
    read:async path=>{try{return await readFile(resolve(root,path),'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}},
  };
}
/** Files to create, workspace-relative, and shared files that already exist and are kept as they are. */
export type Plan=Readonly<{files:Record<string,string>;kept:string[];untranslated?:string[]}>;
const prefix=(directory:string,files:Record<string,string>)=>Object.fromEntries(Object.entries(files).map(([path,content])=>[directory+'/'+path,content]));

// ---------------------------------------------------------------------------------------------------- messages
/** The locales of an app: the base catalog is the default locale's. */
export type AppLocales=Readonly<{defaultLocale:string;locales:readonly string[]}>;
/** The application template ships English only; a product adds its own locales to its registry. */
export const TEMPLATE_LOCALES:AppLocales={defaultLocale:'en',locales:['en']};
const localeCode=/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
/** Reads the registry of `src/config/app.ts` as the application template writes it. */
export function readAppLocales(source:string):AppLocales|undefined{
  const body=/createLocaleRegistry\(\{[\s\S]*?locales:\s*\{([\s\S]*?)\}\s*,\s*defaultLocale:\s*'([^']+)'/.exec(source);
  if(!body)return undefined;
  const locales=[...body[1]!.matchAll(/(?:^|[,{\s])'?([a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3})'?\s*:\s*\{/g)].map(match=>match[1]!);
  if(!locales.length||!locales.includes(body[2]!)||locales.some(code=>!localeCode.test(code)))return undefined;
  return {defaultLocale:body[2]!,locales};
}
const humanize=(name:string)=>name.charAt(0).toUpperCase()+name.slice(1).replaceAll('-',' ');
const quote=(value:string)=>"'"+value.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
const identifier=(code:string)=>code.replaceAll('-','_');
/**
 * The catalog set of a feature: one module per app locale under `model/messages/`, and `model/messages.ts`.
 * The base locale holds the starter text; every other locale starts with the same text, to be translated.
 */
export function messageFiles(directory:string,base:Readonly<Record<string,string>>,locales:AppLocales,depth:number):Record<string,string>{
  const entries=Object.entries(base).map(([key,value])=>'  '+key+': '+quote(value)+',').join('\n');
  const files:Record<string,string>={};
  files[directory+'/messages/'+locales.defaultLocale+'.ts']=`import { defineMessages } from '@mpfrontend/i18n';\n\nexport default defineMessages({\n${entries}\n});\n`;
  for(const code of locales.locales.filter(code=>code!==locales.defaultLocale)){
    files[directory+'/messages/'+code+'.ts']=`import type { Translation } from '@mpfrontend/i18n';\nimport type base from './${locales.defaultLocale}';\n\n// Starts with the base text: translate each message.\nexport default {\n${entries}\n} satisfies Translation<typeof base>;\n`;
  }
  const others=locales.locales.filter(code=>code!==locales.defaultLocale);
  files[directory+'/messages.ts']=`import { coreMessages, createMessages } from '@mpfrontend/i18n';
import { localeRegistry } from '${'../'.repeat(depth)}config/app';
import base from './messages/${locales.defaultLocale}';
${others.map(code=>`import ${identifier(code)} from './messages/${code}';`).join('\n')}${others.length?'\n':''}
/** The messages of this unit. The base catalog defines the keys and their parameters. */
export const messages = createMessages({
  defaultLocale: ${quote(locales.defaultLocale)},
  base,
  // Each other locale of the registry: import its catalog and list it here.
  translations: {${others.length?' '+others.map(code=>code.includes('-')?quote(code)+': '+identifier(code):code).join(', ')+' ':''}},
  core: coreMessages,
  numberingSystem: localeRegistry.numberingSystem,
});
`;
  return files;
}
const listMessages=(name:string)=>({
  title:humanize(name),search:'Search',apply:'Apply',unavailable:'The data is not available. Try again.',empty:'No records found.',
  detail:'Details',back:'Back',pagination:'Pages',pageOf:'Page {page, number} of {count, number}',previous:'Previous',next:'Next',
  yes:'Yes',no:'No',
});
const screenMessages=(name:string)=>({
  title:humanize(name),run:'Run',running:'Running',done:'Done',failed:'Not completed. Try again.',unbound:'Not available yet.',
});

// ---------------------------------------------------------------------------------------------------- features
export type FeatureKind='screen'|'list';
/**
 * Files of a feature, relative to the app directory. Without a resource it is a `screen` feature: a view, a
 * hook, a model, a request boundary and a helper. With a resource of the app's `ftg.config.json` it is a
 * `list` feature: a URL-driven list and detail over that generated read, its entity and its server boundary.
 */
export async function featureFiles(name:string,options:{resource?:string;generatedOutput?:string;locales?:AppLocales}={}):Promise<Record<string,string>>{
  if(!NAME_PATTERN.test(name))throw new Error('INVALID_FEATURE_NAME');
  const locales=options.locales??TEMPLATE_LOCALES;
  const model='features/'+name+'/model';
  if(options.resource===undefined)return prefix('src',{...await templateFiles('feature/screen',{__feature__:name,__Feature__:pascal(name)}),...messageFiles(model,screenMessages(name),locales,3)});
  if(!NAME_PATTERN.test(options.resource))throw new Error('INVALID_RESOURCE_NAME');
  const output=safeRelative(options.generatedOutput??'','INVALID_GENERATED_OUTPUT');
  return prefix('src',{...await templateFiles('feature/list',{
    __FEATURE_TO_OUTPUT__:importPath('src/features/'+name+'/model',output),
    __ENTITY_TO_OUTPUT__:importPath('src/entities/'+options.resource+'/model',output),
    __SERVER_TO_OUTPUT__:importPath('src/api/server',output),
    __RESOURCE_CONSTANT__:constant(options.resource),
    __feature__:name,__Feature__:pascal(name),__resource__:options.resource,__Resource__:pascal(options.resource),
  }),...messageFiles(model,listMessages(name),locales,3)});
}
export type FeatureRequest=Readonly<{app:string;name:string;resource?:string}>;
export async function planFeature(reader:WorkspaceReader,request:FeatureRequest):Promise<Plan>{
  const app=safeRelative(request.app,'INVALID_APP_DIRECTORY');
  if(!NAME_PATTERN.test(request.name))throw new Error('INVALID_FEATURE_NAME');
  if(!await reader.exists(app+'/project.json'))throw new Error('APP_NOT_FOUND');
  if(await reader.exists(app+'/src/features/'+request.name))throw new Error('DESTINATION_EXISTS');
  const locales=readAppLocales(await reader.read(app+'/src/config/app.ts')??'');
  if(!locales)throw new Error('APP_PREREQUISITE_MISSING:src/config/app.ts locale registry');
  // Feature screens render inside the shared page frame.
  const manifest=JSON.parse(await reader.read(app+'/package.json')??'{}') as {dependencies?:Record<string,string>};
  if(!manifest.dependencies?.['@mpfrontend/app-layout'])throw new Error('APP_PREREQUISITE_MISSING:@mpfrontend/app-layout');
  let generatedOutput:string|undefined;
  if(request.resource!==undefined){
    for(const required of ['src/config/app.ts','src/config/server.ts'])if(!await reader.exists(app+'/'+required))throw new Error('APP_PREREQUISITE_MISSING:'+required);
    const config=JSON.parse(await reader.read(app+'/ftg.config.json')??'null') as {output?:unknown;resources?:Array<{name?:unknown}>}|null;
    if(!config||typeof config.output!=='string'||!Array.isArray(config.resources))throw new Error('APP_PREREQUISITE_MISSING:ftg.config.json');
    if(!config.resources.some(resource=>resource.name===request.resource))throw new Error('UNKNOWN_RESOURCE');
    generatedOutput=posix.normalize(config.output);
  }
  const all=prefix(app,await featureFiles(request.name,{locales,...(request.resource!==undefined?{resource:request.resource}:{}),...(generatedOutput?{generatedOutput}:{})}));
  const files:Record<string,string>={},kept:string[]=[];
  for(const [path,content] of Object.entries(all)){
    // The entity and the server boundary of a resource are shared; an existing one is authored and kept.
    if(!path.startsWith(app+'/src/features/')&&await reader.exists(path)){kept.push(path);continue;}
    files[path]=content;
  }
  const untranslated=Object.keys(files).filter(path=>/\/model\/messages\/[^/]+\.ts$/.test(path)&&!path.endsWith('/'+locales.defaultLocale+'.ts')).sort();
  return {files,kept,untranslated};
}

// ------------------------------------------------------------------------------------------------------ routes
const segmentPattern=/^(?:[a-z0-9][a-z0-9-]*|\[[a-z][a-zA-Z0-9]*\])$/;
/** One Next.js route per screen: a thin page that renders a feature screen with the route's base path. */
export function routeFiles(path:string,feature:string,screen:string):Record<string,string>{
  const segments=path.split('/');
  if(!path||segments.some(segment=>!segmentPattern.test(segment))||segments[0]==='api')throw new Error('INVALID_ROUTE_PATH');
  if(!NAME_PATTERN.test(feature))throw new Error('INVALID_FEATURE_NAME');
  if(!/^[A-Z][A-Za-z0-9]{0,79}$/.test(screen))throw new Error('INVALID_SCREEN_NAME');
  const dynamic=segments.filter(segment=>segment.startsWith('[')).map(segment=>segment.slice(1,-1));
  if(new Set(dynamic).size!==dynamic.length)throw new Error('INVALID_ROUTE_PATH');
  const staticPart=segments.slice(0,segments.findIndex(segment=>segment.startsWith('['))>=0?segments.findIndex(segment=>segment.startsWith('[')):segments.length);
  const basePath='/'+staticPart.join('/');
  const entry='../'.repeat(segments.length+1)+'features/'+feature;
  const params=dynamic.length?`type Params = Promise<{ ${dynamic.map(name=>name+': string').join('; ')} }>;\n`:'';
  const props=dynamic.length?'{ params: Params; searchParams: SearchParams }':'{ searchParams: SearchParams }';
  return {['src/app/'+path+'/page.tsx']:`import { ${screen} } from '${entry}';

${params}type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function Page(props: ${props}) {
  return <${screen} {...props} basePath="${basePath}" />;
}
`};
}
export type RouteRequest=Readonly<{app:string;path:string;feature:string;screen?:string}>;
export async function planRoute(reader:WorkspaceReader,request:RouteRequest):Promise<Plan>{
  const app=safeRelative(request.app,'INVALID_APP_DIRECTORY');
  const screen=request.screen??pascal(request.feature)+'Screen';
  const files=prefix(app,routeFiles(request.path,request.feature,screen));
  if(!await reader.exists(app+'/project.json'))throw new Error('APP_NOT_FOUND');
  const entry=await reader.read(app+'/src/features/'+request.feature+'/index.ts');
  if(entry===undefined)throw new Error('UNKNOWN_FEATURE');
  if(!new RegExp('\\b'+screen+'\\b').test(entry))throw new Error('UNKNOWN_FEATURE_SCREEN');
  const directory=app+'/src/app/'+request.path;
  for(const file of ['page.tsx','page.ts','page.jsx','page.js','route.ts','route.js'])if(await reader.exists(directory+'/'+file))throw new Error('DESTINATION_EXISTS');
  return {files,kept:[]};
}

// ---------------------------------------------------------------------------------------------------- packages
export type PackageRuntime='universal'|'client'|'server';
/** A shared package: tags, a public entry, a build to dist and the quality targets of the workspace. */
export async function packageFiles(name:string,scope:string,directory:string,runtime:PackageRuntime='universal'):Promise<Record<string,string>>{
  if(!NAME_PATTERN.test(name))throw new Error('INVALID_PACKAGE_NAME');
  if(!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(scope))throw new Error('INVALID_PACKAGE_SCOPE');
  if(!['universal','client','server'].includes(runtime))throw new Error('INVALID_PACKAGE_RUNTIME');
  if(!/^packages\/[a-z][a-z0-9-]{1,48}$/.test(directory))throw new Error('INVALID_PACKAGE_DIRECTORY');
  return prefix(directory,await templateFiles('package',{__SCOPE__:scope,__name__:name,__runtime__:runtime,__DIRECTORY__:directory}));
}
export type PackageRequest=Readonly<{name:string;directory?:string;runtime?:PackageRuntime}>;
export async function planPackage(reader:WorkspaceReader,request:PackageRequest):Promise<Plan>{
  const directory=request.directory??'packages/'+request.name;
  const manifest=JSON.parse(await reader.read('package.json')??'null') as {name?:unknown}|null;
  if(!manifest||typeof manifest.name!=='string')throw new Error('WORKSPACE_ROOT_REQUIRED');
  const scope=manifest.name.startsWith('@')?manifest.name.slice(1).split('/')[0]!:manifest.name;
  const files=await packageFiles(request.name,scope,directory,request.runtime??'universal');
  if(await reader.exists(directory))throw new Error('DESTINATION_EXISTS');
  return {files,kept:[]};
}

// --------------------------------------------------------------------------------------------- CLI execution
export type CreateOptions=Readonly<{dryRun?:boolean;root?:string;formatter?:Formatter}>;
async function apply(plan:Plan,options:CreateOptions){
  const root=resolve(options.root??process.cwd());
  let formatted=false;
  if(!options.dryRun)formatted=await writeNew(root,plan.files,options.formatter??await workspaceFormatter(root));
  return {files:Object.keys(plan.files).sort(),kept:plan.kept.sort(),...(plan.untranslated?{untranslated:plan.untranslated}:{}),dryRun:options.dryRun===true,formatted};
}
export async function createFeature(request:FeatureRequest&CreateOptions){
  const plan=await planFeature(diskReader(resolve(request.root??process.cwd())),request);
  return {ok:true,kind:(request.resource===undefined?'screen':'list') as FeatureKind,name:request.name,...await apply(plan,request)};
}
export async function createRoute(request:RouteRequest&CreateOptions){
  const plan=await planRoute(diskReader(resolve(request.root??process.cwd())),request);
  return {ok:true,path:request.path,...await apply(plan,request)};
}
export async function createPackage(request:PackageRequest&CreateOptions){
  const plan=await planPackage(diskReader(resolve(request.root??process.cwd())),request);
  return {ok:true,name:request.name,...await apply(plan,request)};
}
