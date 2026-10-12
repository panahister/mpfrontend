// The public API report of each package: the exports of every entry point, from its built declarations. The report
// of the last recorded version is kept as packages/<name>/api-report.json and compared on every check; README.md
// "Versioning" states the policy that a change of the API must follow.
import {readFile,readdir,writeFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {REGISTRY,parseVersion} from './release.mjs';

const exec=promisify(execFile);
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const printer=ts.createPrinter({removeComments:true});
const normalize=text=>text.replace(/\s+/g,' ').trim();

function typesOf(target){
  if(typeof target==='string')return target.endsWith('.d.ts')?{types:target}:{file:target};
  if(target&&typeof target==='object'){
    if(typeof target.types==='string')return {types:target.types};
    for(const value of Object.values(target)){const found=typesOf(value);if(found?.types)return found;}
  }
  return undefined;
}
/** The report of one package directory (its package.json and its built declarations). */
export function apiReport(directory,manifest){
  const entries={},roots=[];
  const exportsField=manifest.exports??{'.':{types:manifest.types}};
  for(const [subpath,target] of Object.entries(exportsField).sort(([a],[b])=>a.localeCompare(b))){
    const found=typesOf(target);
    if(found?.types){roots.push([subpath,join(directory,found.types)]);}
    else entries[subpath]={file:typeof target==='string'?target:JSON.stringify(target)};
  }
  const program=ts.createProgram(roots.map(([,path])=>path),{noEmit:true,skipLibCheck:true,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX});
  const checker=program.getTypeChecker();
  for(const [subpath,path] of roots){
    const source=program.getSourceFile(path);
    if(!source)throw new Error('API_ENTRY_MISSING:'+manifest.name+':'+subpath+':'+path);
    const module=checker.getSymbolAtLocation(source);
    const exported={};
    for(const symbol of module?checker.getExportsOfModule(module):[]){
      const target=symbol.flags&ts.SymbolFlags.Alias?checker.getAliasedSymbol(symbol):symbol;
      exported[symbol.getName()]=(target.getDeclarations()??[]).map(declaration=>{
        const node=ts.isVariableDeclaration(declaration)&&ts.isVariableStatement(declaration.parent.parent)?declaration.parent.parent:declaration;
        return normalize(printer.printNode(ts.EmitHint.Unspecified,node,node.getSourceFile()));
      }).join(' ');
    }
    entries[subpath]=Object.fromEntries(Object.entries(exported).sort(([a],[b])=>a.localeCompare(b)));
  }
  return {schemaVersion:1,package:manifest.name,version:manifest.version,entries};
}

/** What changed from one report to another: an addition never breaks; a removal or a changed declaration does. */
export function compareReports(base,current){
  const added=[],removed=[],changed=[];
  const keys=report=>new Map(Object.entries(report.entries).flatMap(([subpath,value])=>
    'file' in value&&typeof value.file==='string'?[[subpath,'file:'+value.file]]:Object.entries(value).map(([name,text])=>[subpath+' '+name,text])));
  const before=keys(base),after=keys(current);
  for(const [key,text] of before)if(!after.has(key))removed.push(key);else if(after.get(key)!==text)changed.push(key);
  for(const key of after.keys())if(!before.has(key))added.push(key);
  return {added,removed,changed};
}
/**
 * The policy of README.md "Versioning". A change needs a new version; a removal or a change of an export needs a new
 * minor version while the major version is 0, and a new major version after it. A patch never breaks.
 */
export function policyProblems(base,current,difference=compareReports(base,current)){
  const breaking=difference.removed.length+difference.changed.length>0,additive=difference.added.length>0;
  if(!breaking&&!additive)return [];
  const from=parseVersion(base.version),to=parseVersion(current.version);
  if(!from||!to)return ['API_VERSION_INVALID:'+base.version+'>'+current.version];
  const ordered=[to.major-from.major,to.minor-from.minor,to.patch-from.patch].find(step=>step!==0)??0;
  if(ordered<=0)return ['API_CHANGED_WITHOUT_NEW_VERSION:'+current.package+'@'+current.version+' '+describe(difference)];
  if(breaking){
    const enough=from.major===0?to.major>0||to.minor>from.minor:to.major>from.major;
    if(!enough)return ['API_BREAK_NEEDS_'+(from.major===0?'MINOR':'MAJOR')+':'+current.package+' '+base.version+'>'+current.version+' '+describe(difference)];
  }
  return [];
}
const describe=difference=>JSON.stringify(difference);

async function packageDirectories(root){
  return (await readdir(join(root,'packages'))).sort().map(name=>join(root,'packages',name));
}
async function currentReports(root){
  const reports=[];
  for(const directory of await packageDirectories(root)){
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
    reports.push({directory,report:apiReport(directory,manifest)});
  }
  return reports;
}
/** The report of the last published version of a package, from its archive on the registry; undefined when none. */
export async function publishedReport(name,{registry=REGISTRY,fetchImpl=fetch}={}){
  const response=await fetchImpl(registry.replace(/\/$/,'')+'/'+name.replace('/','%2f'),{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(response.status===404)return undefined;
  if(response.status!==200)throw new Error('REGISTRY_ANSWER:'+name+':'+response.status);
  const metadata=await response.json(),latest=metadata['dist-tags']?.latest;
  if(!latest)return undefined;
  const tarball=metadata.versions[latest].dist.tarball;
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-api-baseline-'));
  try{
    const archive=join(directory,'package.tgz');
    const bytes=Buffer.from(await (await fetchImpl(tarball,{signal:AbortSignal.timeout(60000)})).arrayBuffer());
    await writeFile(archive,bytes);await mkdir(join(directory,'out'));
    await exec('tar',['-xzf',archive,'-C',join(directory,'out')]);
    const unpacked=join(directory,'out','package');
    return apiReport(unpacked,JSON.parse(await readFile(join(unpacked,'package.json'),'utf8')));
  }finally{await rm(directory,{recursive:true,force:true});}
}

async function main(args){
  const [command]=args,root=defaultRoot;
  if(command==='check'){
    const problems=[];let compared=0;
    for(const {directory,report} of await currentReports(root)){
      let base;
      try{base=JSON.parse(await readFile(join(directory,'api-report.json'),'utf8'));}
      catch{problems.push('API_REPORT_MISSING:'+report.package+': run pnpm api:update');continue;}
      compared++;
      const difference=compareReports(base,report);
      if(!difference.added.length&&!difference.removed.length&&!difference.changed.length)continue;
      if(base.version===report.version){
        problems.push('API_REPORT_CHANGED:'+report.package+' '+describe(difference)+': if '+report.version+' is not published yet, record the change with pnpm api:update; otherwise move the version as README "Versioning" says');
        continue;
      }
      problems.push(...policyProblems(base,report,difference));
    }
    if(problems.length){console.error(problems.join('\n'));process.exit(1);}
    console.log(JSON.stringify({ok:true,packages:compared}));
  }else if(command==='update'){
    for(const {directory,report} of await currentReports(root))await writeFile(join(directory,'api-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({ok:true,updated:(await packageDirectories(root)).length}));
  }else if(command==='registry'){
    // The release compares the API with the last version the registry published, whatever the reports in the source say.
    const index=args.indexOf('--registry'),registry=index<0?REGISTRY:args[index+1];
    const problems=[];let compared=0,unpublished=0;
    for(const {report} of await currentReports(root)){
      const base=await publishedReport(report.package,{registry});
      if(!base){unpublished++;continue;}
      compared++;problems.push(...policyProblems(base,report));
    }
    if(problems.length){console.error(problems.join('\n'));process.exit(1);}
    console.log(JSON.stringify({ok:true,registry,comparedWithPublished:compared,neverPublished:unpublished}));
  }else throw new Error('USAGE: api-report.mjs check|update|registry [--registry <url>]');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main(process.argv.slice(2));
