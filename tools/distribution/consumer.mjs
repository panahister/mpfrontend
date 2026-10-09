// Install real packed packages into a fresh, independent Nx workspace. Never import platform source.
import {mkdtemp, readFile, writeFile, mkdir, cp, lstat, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import assert from 'node:assert/strict';
import {parse,stringify} from 'yaml';
import {verifyDesignConsumer} from './design-consumer.mjs';
import {independentToolchain} from './toolchain.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Advisory upload is an explicit opt-in; offline validation must never imply it ran.
const onlineAudit=process.argv.includes('--online-audit');
assert.ok(process.argv.slice(2).every(arg=>arg==='--online-audit'),'UNKNOWN_CONSUMER_OPTION');
const temporary=await mkdtemp(join(tmpdir(),'mpfrontend-packed-consumer-'));
// A nested pnpm/Nx invocation must not borrow executables from the source checkout's PATH: no node_modules/.bin
// entry is kept, and the pinned Node and pnpm are reached by their explicit paths, wherever they live.
const independentPath=(await independentToolchain(join(temporary,'toolchain'))).path;
const workspace=join(temporary,'consumer');
const bootstrap=join(temporary,'bootstrap');
await mkdir(bootstrap);
await cp(join(root,'artifacts/packages'),join(bootstrap,'artifacts/packages'),{recursive:true});
const inventory=JSON.parse(await readFile(join(bootstrap,'artifacts/packages/inventory.json'),'utf8'));
const sourceManifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const overrides=Object.fromEntries(inventory.packages.map(p=>[p.name,'file:artifacts/packages/'+p.file]));
await writeFile(join(bootstrap,'package.json'),JSON.stringify({name:'independent-cli-bootstrap',
  private:true,type:'module',packageManager:sourceManifest.packageManager,engines:sourceManifest.engines,
  dependencies:{'@mpfrontend/ftg-cli':overrides['@mpfrontend/ftg-cli'],nx:sourceManifest.devDependencies.nx}},null,2));
// Preserve the source install policy, including narrowly pinned exceptions, rather than bypass it.
const policy=parse(await readFile(join(root,'pnpm-workspace.yaml'),'utf8'));
await writeFile(join(bootstrap,'pnpm-workspace.yaml'),stringify({...policy,packages:[],
  overrides:{...policy.overrides,...overrides}}));
// Runs a nested command. With capture, both of its streams are collected (and stderr is still shown as it arrives);
// `run` resolves with the standard output, `runBoth` with both streams, so that an assertion about what a command
// printed can look at the stream the message really came on.
async function runBoth(command,args,{expectedCode=0,cwd=workspace,capture=false}={}){
  return await new Promise((resolve,reject)=>{
    let stdout='',stderr='';
    const child=spawn(command,args,{cwd,stdio:['ignore',capture?'pipe':'inherit',capture?'pipe':'inherit'],env:{...process.env,PATH:independentPath,
      NX_DAEMON:'false',NX_ISOLATE_PLUGINS:'false',NEXT_TELEMETRY_DISABLED:'1',
      pnpm_config_verify_deps_before_run:'false'}});
    const tooLarge=()=>{child.kill();reject(new Error('CONSUMER_CAPTURE_TOO_LARGE'));};
    if(capture){
      child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>1048576)tooLarge();});
      child.stderr.on('data',chunk=>{stderr+=chunk;process.stderr.write(chunk);if(stderr.length>1048576)tooLarge();});
    }
    child.on('error',reject);child.on('close',code=>code===expectedCode?resolve({stdout,stderr}):reject(new Error('CONSUMER_COMMAND_FAILED:'+command+':'+code)));
  });
}
const run=async(command,args,options)=>(await runBoth(command,args,options)).stdout;
console.log(JSON.stringify({stage:'independent-consumer',workspace}));
// Resolve public third-party dependencies once; every MP Frontend package is still forced to a local archive.
await run('pnpm',['install','--no-frozen-lockfile'],{cwd:bootstrap});
const reportedVersion=(await run('pnpm',['exec','mpfrontend','--version'],{cwd:bootstrap,capture:true})).trim();
assert.equal(reportedVersion,inventory.packages.find(p=>p.name==='@mpfrontend/ftg-cli').version);
const existingWorkspace=join(temporary,'existing-mode');
await run('pnpm',['exec','mpfrontend','init','--name','existing-consumer','--directory',existingWorkspace,'--design-source','existing','--json'],{cwd:bootstrap});
const existingConfig=JSON.parse(await readFile(join(existingWorkspace,'.mpfrontend/design-source.json'),'utf8'));
assert.equal(existingConfig.source,'existing');assert.equal(existingConfig.status,'pending');assert.equal(existingConfig.binding,null);assert.equal(existingConfig.bindingHash,null);assert.equal(existingConfig.release,null);
const publicModeWorkspace=join(temporary,'public-template-mode');
await run('pnpm',['exec','mpfrontend','init','--name','public-template-consumer','--directory',publicModeWorkspace,'--design-source','mpfrontend','--json'],{cwd:bootstrap,expectedCode:2});
await assert.rejects(lstat(publicModeWorkspace),{code:'ENOENT'});
await run('pnpm',['exec','mpfrontend','init','--name','independent-consumer','--directory',workspace,'--design-source','none','--dry-run','--json'],{cwd:bootstrap});
await assert.rejects(lstat(workspace),{code:'ENOENT'});
await run('pnpm',['exec','mpfrontend','init','--name','independent-consumer','--directory',workspace,'--design-source','none','--json'],{cwd:bootstrap});
assert.deepEqual(JSON.parse(await readFile(join(workspace,'.mpfrontend/design-source.json'),'utf8')),{
  schemaVersion:1,generator:'MPFrontendDesignSource',cliVersion:reportedVersion,source:'none',status:'disabled',binding:null,bindingHash:null,sourceIdentity:null,release:null
});
const initialManifest=await readFile(join(workspace,'package.json'),'utf8');
await run('pnpm',['exec','mpfrontend','init','--name','independent-consumer','--directory',workspace,'--design-source','none','--json'],{cwd:bootstrap,expectedCode:2});
assert.equal(await readFile(join(workspace,'package.json'),'utf8'),initialManifest);
await cp(join(bootstrap,'artifacts/packages'),join(workspace,'artifacts/packages'),{recursive:true});
const consumerPolicy=parse(await readFile(join(workspace,'pnpm-workspace.yaml'),'utf8'));
await writeFile(join(workspace,'pnpm-workspace.yaml'),stringify({...consumerPolicy,
  overrides:{...consumerPolicy.overrides,...overrides}}));
const securityManifest=JSON.parse(await readFile(join(workspace,'package.json'),'utf8'));
securityManifest.devDependencies['@mpfrontend/security-bff']=overrides['@mpfrontend/security-bff'];
securityManifest.devDependencies['@mpfrontend/realtime-core']=overrides['@mpfrontend/realtime-core'];
securityManifest.devDependencies.tsx=sourceManifest.devDependencies.tsx;
await writeFile(join(workspace,'package.json'),JSON.stringify(securityManifest,null,2));
const contractDirectory=join(workspace,'contracts/openapi/presentation/sample');
await mkdir(contractDirectory,{recursive:true});
const item={type:'object',required:['name'],properties:{name:{type:'string',readOnly:true}}};
const page={type:'object',required:['items','number','size','total','pageCount','hasMore'],properties:{items:{type:'array',items:item},number:{type:'integer'},size:{type:'integer'},total:{type:'integer'},pageCount:{type:'integer'},hasMore:{type:'boolean'}}};
const response={description:'Catalog',content:{'application/json':{schema:page}}};
const submissionBody={type:'object',additionalProperties:false,required:['name','quantity','approved'],properties:{name:{type:'string',minLength:2},quantity:{type:'integer',minimum:1},approved:{type:'boolean'},serverId:{type:'string',readOnly:true}}};
const cancellationBody={oneOf:[{type:'null'},{type:'object',additionalProperties:false,required:['note'],properties:{note:{type:['string','null']}}}]};
const submissionResult={description:'Synthetic acceptance',content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string',format:'uuid',readOnly:true}}}}}};
const contractFixture={openapi:'3.1.0',info:{title:'Synthetic generator acceptance fixture',version:'1.0.0'},paths:{
  '/catalog':{get:{operationId:'listCatalog',responses:{'200':response}}},
  '/fixture/submission':{
    post:{operationId:'submitFixture',requestBody:{required:true,content:{'application/json':{schema:submissionBody}}},responses:{'202':submissionResult}},
    delete:{operationId:'removeFixture',responses:{'200':submissionResult}}
  },
  '/fixture/cancel':{post:{operationId:'cancelFixture',requestBody:{required:false,content:{'application/json':{schema:cancellationBody}}},responses:{'200':submissionResult}}},
  '/fixture/report':{post:{operationId:'reportFixture',requestBody:{required:true,content:{'application/json':{schema:submissionBody}}},responses:{'204':{description:'Synthetic empty acceptance'}}}}
}};
await writeFile(join(contractDirectory,'openapi.json'),JSON.stringify(contractFixture));
await run('pnpm',['install','--no-frozen-lockfile']);
const catalog=JSON.parse(await run('pnpm',['exec','mpfrontend','skills','list','--json'],{capture:true}));
assert.equal(catalog.skills.length,18);assert.equal(catalog.skills.filter(s=>s.available).length,18);
assert.ok(catalog.skills.find(s=>s.name==='mpfrontend-configure-i18n').available);
const skillDryRunBefore=await readFile(join(workspace,'package.json'),'utf8');
const instructions=await Promise.all(['AGENTS.md','CLAUDE.md'].map(name=>readFile(join(workspace,name),'utf8')));
await run('pnpm',['exec','mpfrontend','skills','install','--for','both','--profile','base','--dry-run','--json']);
assert.equal(await readFile(join(workspace,'package.json'),'utf8'),skillDryRunBefore);
await run('pnpm',['exec','mpfrontend','skills','install','--for','both','--profile','base','--json']);
assert.equal(JSON.parse(await run('pnpm',['exec','mpfrontend','skills','check','--json'],{capture:true})).checked,28);
assert.deepEqual(await Promise.all(['AGENTS.md','CLAUDE.md'].map(name=>readFile(join(workspace,name),'utf8'))),instructions);
await run('pnpm',['exec','mpfrontend','skills','update','--dry-run','--json']);
const skillPath=join(workspace,'.agents/skills/mpfrontend-scaffold-app/SKILL.md');
const skill=await readFile(skillPath,'utf8');await writeFile(skillPath,skill+'\nConsumer-authored edit.\n');
await run('pnpm',['exec','mpfrontend','skills','check','--json'],{expectedCode:3});
await run('pnpm',['exec','mpfrontend','skills','update','--json'],{expectedCode:4});
assert.equal(await readFile(skillPath,'utf8'),skill+'\nConsumer-authored edit.\n');await writeFile(skillPath,skill);
await run('pnpm',['exec','mpfrontend','skills','check','--json']);
await run('pnpm',['exec','mpfrontend','skills','update','--for','both','--profile','design','--json']);
assert.equal(JSON.parse(await run('pnpm',['exec','mpfrontend','skills','check','--json'],{capture:true})).checked,36);
assert.ok((await readFile(join(workspace,'.claude/skills/mpfrontend-review-design-drift/SKILL.md'),'utf8')).includes('read-only'));
await verifyDesignConsumer({workspace,run});
await run('pnpm',['exec','mpfrontend','create','app','--name','sample','--directory','apps/sample']);
async function filesUnder(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await filesUnder(path));else result.push(path);
  }
  return result;
}
// The application template ships English only: one English catalog per set and a registry with English alone.
const templateCatalogs=(await filesUnder(join(workspace,'apps/sample/src'))).filter(path=>basename(dirname(path))==='messages');
assert.ok(templateCatalogs.length>=3&&templateCatalogs.every(path=>basename(path)==='en.ts'),'TEMPLATE_NOT_ENGLISH_ONLY');
assert.match(await readFile(join(workspace,'apps/sample/src/config/app.ts'),'utf8'),/locales: \{ en: \{ direction: 'ltr' \} \},\n  defaultLocale: 'en',/);
// The feature, route and package generators on the fresh workspace: a screen feature and its route, a
// second list feature over the template's read with a list and a detail route, and a shared package.
const created=[];
for(const args of [['feature','--app','apps/sample','--name','order-review'],['route','--app','apps/sample','--path','order-review','--feature','order-review'],
  ['feature','--app','apps/sample','--name','archive','--resource','catalog'],['route','--app','apps/sample','--path','archive','--feature','archive'],
  ['route','--app','apps/sample','--path','archive/[position]','--feature','archive','--screen','ArchiveDetailScreen'],
  ['package','--name','shared-format','--runtime','universal']]){
  const preview=JSON.parse(await run('pnpm',['exec','mpfrontend','create',...args,'--dry-run','--json'],{capture:true}));
  for(const path of preview.files)await assert.rejects(lstat(join(workspace,path)),{code:'ENOENT'});
  const result=JSON.parse(await run('pnpm',['exec','mpfrontend','create',...args,'--json'],{capture:true}));
  assert.deepEqual(result.files,preview.files);assert.equal(result.formatted,true);created.push(...result.files);
  await run('pnpm',['exec','mpfrontend','create',...args,'--json'],{expectedCode:2});
}
assert.deepEqual(JSON.parse(await run('pnpm',['exec','mpfrontend','create','feature','--app','apps/sample','--name','archive-two','--resource','catalog','--json'],{capture:true})).kept.length,4);
assert.ok((await filesUnder(join(workspace,'apps/sample/src'))).filter(path=>basename(dirname(path))==='messages').every(path=>basename(path)==='en.ts'),'GENERATED_CATALOG_NOT_ENGLISH');
await rm(join(workspace,'apps/sample/src/features/archive-two'),{recursive:true});
// The Nx generators are the same generators; a dry run writes nothing.
await run('pnpm',['exec','nx','g','@mpfrontend/nx-plugin:package','--name','nx-probe','--dry-run','--no-interactive']);
await assert.rejects(lstat(join(workspace,'packages/nx-probe')),{code:'ENOENT'});
// Generated output is already in the workspace formatter's layout, before any consumer edit.
await run('pnpm',['exec','prettier','--check','apps/sample','packages/shared-format','CODEOWNERS','.agents/skills/README.md','--ignore-unknown']);
assert.ok((await readFile(join(workspace,'apps/sample/.env.example'),'utf8')).split('\n').every(line=>line===''||line.startsWith('#')||line.endsWith('=')));
console.log(JSON.stringify({stage:'scaffolding-generators',ok:true,createdFiles:created.length}));
// Real consumer extension: no pre-existing dist; only the generated ^build edge may create it in time.
const projectPath=join(workspace,'apps/sample/project.json');
const generatedProject=JSON.parse(await readFile(projectPath,'utf8'));
assert.deepEqual(generatedProject.implicitDependencies??[],[]);
assert.ok(generatedProject.targets.build.dependsOn.includes('^build'));
generatedProject.implicitDependencies=['fixture-foundation'];
await writeFile(projectPath,JSON.stringify(generatedProject,null,2));
const foundation=join(workspace,'packages/foundation');await mkdir(join(foundation,'src'),{recursive:true});
await writeFile(join(foundation,'package.json'),JSON.stringify({name:'@independent/foundation',version:'0.0.0',private:true,type:'module',exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}}}));
// A consumer package carries the boundary tags of the quality profile; an app may depend only on type:package.
await writeFile(join(foundation,'project.json'),JSON.stringify({name:'fixture-foundation',projectType:'library',tags:['type:package','scope:shared','runtime:universal'],targets:{build:{executor:'nx:run-commands',outputs:['{projectRoot}/dist'],options:{command:'node packages/foundation/build.mjs'}}}}));
await writeFile(join(foundation,'src/index.js'),'export const fixtureFoundation="Consumer-owned foundation";\n');
await writeFile(join(foundation,'build.mjs'),'import {mkdir,readFile,writeFile} from "node:fs/promises";const root=new URL("./",import.meta.url);await mkdir(new URL("dist/",root),{recursive:true});await writeFile(new URL("dist/index.js",root),await readFile(new URL("src/index.js",root)));await writeFile(new URL("dist/index.d.ts",root),"export declare const fixtureFoundation:string;\\n");');
await assert.rejects(lstat(join(foundation,'dist')),{code:'ENOENT'});
const fixtureManifestPath=join(workspace,'apps/sample/package.json');
const fixtureManifest=JSON.parse(await readFile(fixtureManifestPath,'utf8'));
fixtureManifest.dependencies['@independent/foundation']='workspace:*';await writeFile(fixtureManifestPath,JSON.stringify(fixtureManifest,null,2));
const configPath=join(workspace,'apps/sample/ftg.config.json');
const config=JSON.parse(await readFile(configPath,'utf8'));
config.resources.push({name:'submission',operationId:'submitFixture',responseStatus:'202'});
config.resources.push({name:'remove-submission',operationId:'removeFixture',responseStatus:'200'});
config.resources.push({name:'cancel-submission',operationId:'cancelFixture',responseStatus:'200'});
config.resources.push({name:'reporting',operationId:'reportFixture',responseStatus:'204',body:'none'});
config.requests=[{name:'submission',operationId:'submitFixture'},{name:'remove-submission',operationId:'removeFixture',body:'none'},{name:'cancel-submission',operationId:'cancelFixture',body:'optional-json'},{name:'reporting',operationId:'reportFixture'}];
await writeFile(configPath,JSON.stringify(config,null,2));
// Synthetic preview only: compile the packed UI/request validators in a real client route; send no API mutation.
const preview=join(workspace,'apps/sample/src/app/request-check');await mkdir(preview);
await writeFile(join(preview,'page.tsx'),`'use client';
import {useState} from 'react';
import {ResourceForm} from '@mpfrontend/ui';
import {fixtureFoundation} from '@independent/foundation';
import {requests} from '../../api/generated/catalog/requests.gen';
import {parseRequest} from '../../api/generated/catalog/request-models.gen';
export default function RequestCheck(){const [values,setValues]=useState<Record<string,unknown>>({name:'Example',quantity:1,approved:false}),[result,setResult]=useState('');
// A synthetic verification page: it shows machine values only, so it needs no catalog message.
return <main><p>{fixtureFoundation}</p><ResourceForm fields={requests[0]!.fields} values={values} saveLabel={requests[0]!.name} onChange={(key,value)=>setValues(old=>({...old,[key]:value}))} onSubmit={()=>{try{setResult(JSON.stringify(parseRequest('submission',values)));}catch{setResult('INVALID_API_REQUEST');}}}/><p role="status">{result}</p></main>;}
`);
const overridePath=join(workspace,'apps/sample/src/features/catalog/model/overrides/index.ts');
const authored=(await readFile(overridePath,'utf8'))+'\n// Consumer-authored preservation sentinel.\n';
await writeFile(overridePath,authored);
await run('pnpm',['exec','mpfrontend','create','app','--name','sample','--directory','apps/sample'],{expectedCode:2});
assert.equal(await readFile(overridePath,'utf8'),authored);
// A product whose only locale is its own, written right to left. The fixture is a private-use pseudo-locale
// tag whose text is English, marked, so that any framework fallback would show unmarked English. The product
// changes its own files only: its registry, its catalogs and the default locale of each catalog set.
const RTL='qps-plocm',MARK='[rtl] ';
await run('pnpm',['exec','mpfrontend','create','app','--name','product','--directory','apps/product']);
// The product reads the same synthetic contract under its own app name.
await mkdir(join(workspace,'contracts/openapi/presentation/product'),{recursive:true});
await writeFile(join(workspace,'contracts/openapi/presentation/product/openapi.json'),JSON.stringify(contractFixture));
const productApp=join(workspace,'apps/product');
const productConfigPath=join(productApp,'src/config/app.ts'),productConfig=await readFile(productConfigPath,'utf8');
const productRegistry=productConfig.replace(/createLocaleRegistry\(\{[\s\S]*?\n\}\);/,"createLocaleRegistry({\n  locales: { '"+RTL+"': { direction: 'rtl' } },\n  defaultLocale: '"+RTL+"',\n});");
assert.notEqual(productRegistry,productConfig);await writeFile(productConfigPath,productRegistry);
const replacedEnglish=[];
for(const catalog of (await filesUnder(join(productApp,'src'))).filter(path=>basename(dirname(path))==='messages')){
  assert.equal(basename(catalog),'en.ts');
  const source=await readFile(catalog,'utf8');
  const marked=source.replace(/(:\s*)'((?:\\.|[^'\\])*)'/g,(_,separator,text)=>{replacedEnglish.push(text);return separator+"'"+MARK+text+"'";});
  assert.notEqual(marked,source);
  await writeFile(join(dirname(catalog),RTL+'.ts'),marked);await rm(catalog);
}
let catalogSets=0;
for(const file of (await filesUnder(join(productApp,'src'))).filter(path=>/\.tsx?$/.test(path))){
  const source=await readFile(file,'utf8');
  if(!source.includes("from './messages/en';"))continue;
  const adopted=source.replace("from './messages/en';","from './messages/"+RTL+"';").replace("defaultLocale: 'en',","defaultLocale: '"+RTL+"',");
  assert.ok(!adopted.includes("'en'"),file);await writeFile(file,adopted);catalogSets++;
}
assert.equal(catalogSets,3);
// The feature generator follows the product's registry: its catalog is the base, and no English file exists.
const productFeature=JSON.parse(await run('pnpm',['exec','mpfrontend','create','feature','--app','apps/product','--name','review','--json'],{capture:true}));
assert.deepEqual(productFeature.files.filter(path=>path.includes('/model/messages')),['apps/product/src/features/review/model/messages.ts','apps/product/src/features/review/model/messages/'+RTL+'.ts']);
assert.deepEqual(productFeature.untranslated,[]);
console.log(JSON.stringify({stage:'product-only-locale',ok:true,locale:RTL,direction:'rtl',catalogSets,markedMessages:replacedEnglish.length}));
// Resolve newly scaffolded public third-party dependencies once, then prove the exact
// resulting lockfile can be installed without registry access. MP Frontend packages
// remain forced to the locally packed archives by the workspace overrides.
await run('pnpm',['install','--no-frozen-lockfile']);
await run('pnpm',['install','--offline','--frozen-lockfile']);
// Execute the real outage assertions against the installed export, never the checkout implementation.
const securityProofDirectory=join(workspace,'verification');await mkdir(securityProofDirectory);
let securityProof=await readFile(join(root,'packages/security-bff/tests/refresh-outage.test.ts'),'utf8');
for(const [source,target]of [["'../src/index.js'","'@mpfrontend/security-bff'"],["'../src/session-store.js'","'@mpfrontend/security-bff/session-store'"]]){
  assert.ok(securityProof.includes(source));securityProof=securityProof.replace(source,target);
}
assert.ok(!securityProof.includes('../src/'));
await writeFile(join(securityProofDirectory,'refresh-outage.test.ts'),securityProof);
await run(process.execPath,['--import','tsx','--test','verification/refresh-outage.test.ts']);
let realtimeProof=await readFile(join(root,'packages/realtime-core/tests/browser-recovery.test.ts'),'utf8');
for(const [source,target]of [["'../src/react.ts'","'../node_modules/@mpfrontend/realtime-core/dist/react.js'"],
  ["'../src/index.ts'","'../node_modules/@mpfrontend/realtime-core/dist/index.js'"],
  ["'../src/react.js'","'@mpfrontend/realtime-core/react'"]]){
  assert.ok(realtimeProof.includes(source));realtimeProof=realtimeProof.replace(source,target);
}
assert.ok(!realtimeProof.includes('../src/'));
await writeFile(join(securityProofDirectory,'browser-recovery.test.ts'),realtimeProof);
await run(process.execPath,['--import','tsx','--test','verification/browser-recovery.test.ts']);
const {reconnectDelay}=await import(join(workspace,'node_modules/@mpfrontend/realtime-core/dist/index.js'));
const earliestTenthAdmission=Array.from({length:9},(_,attempt)=>reconnectDelay(attempt,()=>0)).reduce((sum,value)=>sum+value,0);
assert.equal(earliestTenthAdmission,60750);
if(onlineAudit)await run('pnpm',['audit','--audit-level=moderate']);
else console.log(JSON.stringify({stage:'dependency-audit',status:'not-run',reason:'EXPLICIT_METADATA_UPLOAD_AUTHORIZATION_REQUIRED'}));
// The consumer formats its own edits, then runs the gate that init wrote: the format check, then lint,
// typecheck, test, build and generated-check of every project, uncached. The design fixture is a
// hash-bound export, so the consumer lists it in its formatter ignore file as the generated file asks.
await writeFile(join(workspace,'.prettierignore'),(await readFile(join(workspace,'.prettierignore'),'utf8'))+'design-fixture/\n');
await run('pnpm',['run','format']);
// Generated output is produced and checked in before the gate, as after any ftg.config.json change.
await run('pnpm',['exec','nx','run','sample:ftg-generate','--skip-nx-cache']);
await run('pnpm',['exec','nx','run','product:ftg-generate','--skip-nx-cache']);
await run('pnpm',['check','--skip-nx-cache']);
// The app's design-verify target: this workspace's design source is attached, so it revalidates the binding.
const designVerify=await run('pnpm',['exec','nx','run','sample:design-verify','--skip-nx-cache'],{capture:true});
const designStatus=JSON.parse(designVerify.split('\n').find(line=>line.startsWith('{"ok"'))??'{}');
assert.equal(designStatus.ok,true);assert.equal(designStatus.source,'existing');assert.equal(designStatus.status,'attached');
console.log(JSON.stringify({stage:'design-verify-target',ok:true,source:designStatus.source,status:designStatus.status}));
// The app build compiles Tailwind v4 over the published UI and shell output: the structural class p-6 of
// Card and the shell's content width are rules of the built CSS, and the app theme follows the neutral tokens.
async function cssFiles(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await cssFiles(path));else if(entry.name.endsWith('.css'))result.push(path);
  }
  return result;
}
const builtCss=(await Promise.all((await cssFiles(join(workspace,'apps/sample/.next/static'))).map(path=>readFile(path,'utf8')))).join('\n');
assert.match(builtCss,/\.p-6\{padding:/,'TAILWIND_STRUCTURAL_CLASS_NOT_COMPILED');
assert.match(builtCss,/max-width:var\(--mp-shell-content-max\)/,'SHELL_STRUCTURAL_CLASS_NOT_COMPILED');
const fallback=builtCss.indexOf('--mp-surface-canvas:'),theme=builtCss.search(/:root\[data-brand=["']?neutral["']?\]\{--mp-shell-content-max:75rem/);
assert.ok(fallback>=0&&theme>fallback,'THEME_FILE_NOT_AFTER_TOKEN_FALLBACK');
console.log(JSON.stringify({stage:'built-css',ok:true,structuralClass:'p-6',shellClass:'max-w-[var(--mp-shell-content-max)]',themeAfterFallback:true}));
// Each built app is served on a free loopback port; its BFF origin is a closed local port.
async function served(directory,check){
  const port=await new Promise((resolve,reject)=>{const probe=createNetServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(()=>resolve(value));});});
  const server=spawn(join(directory,'node_modules/.bin/next'),['start','.','-p',String(port),'-H','127.0.0.1'],{cwd:directory,detached:true,stdio:'ignore',
    env:{...process.env,PATH:independentPath,NEXT_TELEMETRY_DISABLED:'1',BFF_ORIGIN:'http://127.0.0.1:9'}});
  try{
    await check(async preference=>{
      for(let attempt=0;attempt<120;attempt++){
        try{const response=await fetch('http://127.0.0.1:'+port+'/catalog',{headers:preference?{cookie:'mp_preferences='+preference}:{}});if(response.ok)return await response.text();}catch{}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      throw new Error('APP_DID_NOT_START');
    });
  }finally{try{process.kill(-server.pid,'SIGTERM');}catch{}}
}
const escapeExpression=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// The template's English messages that a page shows as text, as an attribute value or in a serialized string.
const englishShown=html=>replacedEnglish.filter(text=>!text.includes('{')&&new RegExp('[>"]'+escapeExpression(text)+'[<"\\\\]').test(html));
let detectedOnEnglish=0;
// The English-only app: the first paint takes language, direction and theme from the shared preference
// cookie; the fixture locale is not a built-in locale, and an unknown or crafted value is the default.
await served(join(workspace,'apps/sample'),async page=>{
  const fixture=await page('lang='+RTL+'&theme=dark');
  assert.match(fixture,/<html lang="en" dir="ltr" data-brand="neutral" data-mode="dark"/);
  assert.match(fixture,/focus:start-4/);assert.match(fixture,/border-s-4/);
  assert.doesNotMatch(fixture,/\b(?:ml|mr|pl|pr|left|right)-\d/);
  assert.match(await page('lang=xx'),/<html lang="en" dir="ltr"/);
  const crafted=await page('lang=%3Cprobe%3E&theme=%3Cprobe%3E');
  assert.match(crafted,/<html lang="en" dir="ltr" data-brand="neutral" data-mode="system"/);
  assert.ok(!crafted.includes('<probe>')&&!crafted.includes('%3Cprobe%3E'),'an invalid preference is never echoed');
  const english=await page();
  assert.match(english,/<html lang="en" dir="ltr"/);
  // The detector of English text finds the template's messages on the English app.
  detectedOnEnglish=englishShown(english).length;
  assert.ok(detectedOnEnglish>=10,'ENGLISH_DETECTOR_FOUND:'+detectedOnEnglish);
});
console.log(JSON.stringify({stage:'served-english',ok:true,default:'en',fixtureLocale:'not-built-in',firstPaintTheme:'dark',unknown:'default-en',invalidPreference:'ignored-not-echoed',englishMessagesDetected:detectedOnEnglish}));
// The product-only app: its locale is the default and the only locale, the document is right to left on the
// first visit, the layout is logical, and no English text replaces a message that the product supplied.
await served(productApp,async page=>{
  const first=await page();
  assert.match(first,new RegExp('<html lang="'+RTL+'" dir="rtl" data-brand="neutral" data-mode="system"'));
  for(const text of ['Skip to content','Main navigation','Catalog','The data is not available. Try again.','Independent MP Frontend consumer'])assert.ok(first.includes(MARK+text),'PRODUCT_TEXT_MISSING:'+text);
  assert.match(first,/focus:start-4/);assert.match(first,/border-s-4/);
  assert.doesNotMatch(first,/\b(?:ml|mr|pl|pr|left|right)-\d/);
  assert.deepEqual(englishShown(first),[],'ENGLISH_FALLBACK_SHOWN');
  assert.match(await page('lang=en&theme=dark'),new RegExp('<html lang="'+RTL+'" dir="rtl" data-brand="neutral" data-mode="dark"'));
});
console.log(JSON.stringify({stage:'served-product-locale',ok:true,locale:RTL,direction:'rtl',englishFallbackShown:0}));
// A build must not rewrite a formatted file (for example a framework editing the app tsconfig).
await run('pnpm',['run','format:check']);
// Negative controls of the profile: an app importing another app, a raw colour and hand-written CSS fail lint.
await run('pnpm',['exec','mpfrontend','create','app','--name','other','--directory','apps/other']);
const probes={'apps/sample/src/boundary-probe.ts':"import { appId } from '../../other/src/config/app';\nexport const probe = appId;\n",
  'apps/sample/src/app/entry-probe/page.tsx':"export { CatalogList as default } from '../../features/catalog/ui/catalog-list';\n",
  'apps/sample/src/text-probe.tsx':'export const Probe = () => <p>Literal text</p>;\n',
  'apps/sample/src/join-probe.tsx':"declare const t: (key: string) => string;\nexport const Probe = ({ n }: { n: number }) => <p>{t('page')} {n}</p>;\n",
  'apps/sample/src/colour-probe.tsx':'export const Probe = () => <p className="bg-[#123456]" />;\n',
  'apps/sample/src/physical-probe.tsx':'export const Probe = () => <p className="ml-2" style={{ paddingRight: 4 }} />;\n',
  'apps/sample/src/probe.css':'.probe {\n  display: flex;\n}\n',
  'apps/sample/src/physical-probe.css':'.physical-probe {\n  margin-left: 1rem;\n}\n'};
for(const [path,content]of Object.entries(probes)){await mkdir(dirname(join(workspace,path)),{recursive:true});await writeFile(join(workspace,path),content);}
const lintRun=await runBoth('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache'],{expectedCode:1,capture:true});
// ESLint prints its findings on standard output and a failure to read a configuration file on standard error: both are read.
const lintFailure=lintRun.stdout+'\n'+lintRun.stderr;
const lintRules=['@nx/enforce-module-boundaries','mpfrontend/no-raw-color','mpfrontend/no-handwritten-css','mpfrontend/public-entry','mpfrontend/no-literal-text','mpfrontend/logical-properties'];
for(const rule of lintRules)assert.ok(lintFailure.includes(rule),'LINT_NEGATIVE_CONTROL_MISSING:'+rule);
// The findings ESLint printed under one file: its report is the path, then one indented line per finding.
function findingsUnder(report,suffix){
  const lines=report.replace(/\u001b\[[0-9;]*m/g,'').split('\n'),start=lines.findIndex(line=>line.trimEnd().endsWith(suffix));
  if(start<0)return '';
  const end=lines.findIndex((line,index)=>index>start&&line.trim()==='');
  return lines.slice(start+1,end<0?undefined:end).join('\n');
}
// A physical side in a stylesheet is refused by this rule, as one in a class name is: the finding for that very value,
// under the file that holds it (physical-probe.tsx has an inline style that the rule refuses too, so the rule name alone proves nothing).
const physicalFinding=(file,value)=>findingsUnder(lintFailure,file).split('\n').some(line=>line.includes("Physical '"+value+"'")&&line.includes('mpfrontend/logical-properties'));
assert.ok(physicalFinding('apps/sample/src/physical-probe.css','margin-left'),'LINT_NEGATIVE_CONTROL_MISSING:logical-properties-in-stylesheet');
assert.ok(physicalFinding('apps/sample/src/physical-probe.tsx','ml-2'),'LINT_NEGATIVE_CONTROL_MISSING:logical-properties-in-class-name');
for(const [stream,text] of [['stdout',lintRun.stdout],['stderr',lintRun.stderr]])assert.ok(!text.includes('Error reading "tsconfig.base.json"'),'the boundary rule finds the root TypeScript configuration ('+stream+')');
console.log(JSON.stringify({stage:'lint-negative-controls',ok:true,observedFailures:lintRules}));
for(const path of Object.keys(probes))await rm(join(workspace,path));
await rm(join(workspace,'apps/sample/src/app/entry-probe'),{recursive:true});
await run('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache']);
// The tag constraint itself, not only the relative-path rule: an app depends only on packages. Code of another app
// in a library tagged type:app, imported by its package name, is refused by that constraint, and accepted once the
// constraint lets type:app depend on any tag.
const otherAppCode=join(workspace,'packages/other-app-code');
await mkdir(join(otherAppCode,'src'),{recursive:true});
await writeFile(join(otherAppCode,'package.json'),JSON.stringify({name:'@independent/other-app-code',version:'0.0.0',private:true,type:'module',exports:{'.':'./src/index.ts'}}));
await writeFile(join(otherAppCode,'project.json'),JSON.stringify({name:'other-app-code',projectType:'library',tags:['type:app','scope:other','runtime:universal']}));
await writeFile(join(otherAppCode,'src/index.ts'),"export const otherAppCode = 'other';\n");
const crossAppProbe=join(workspace,'apps/sample/src/cross-app-probe.ts');
await writeFile(crossAppProbe,"import { otherAppCode } from '@independent/other-app-code';\nexport const probe = otherAppCode;\n");
const tagRun=await runBoth('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache'],{expectedCode:1,capture:true});
const tagFailure=tagRun.stdout+'\n'+tagRun.stderr;
assert.ok(tagFailure.includes('A project tagged with "type:app" can only depend on libs tagged with "type:package"'),'TAG_CONSTRAINT_NOT_EXERCISED');
assert.ok(!tagFailure.includes('Projects cannot be imported by a relative or absolute path'),'the refusal comes from the tag constraint');
const rootLint=join(workspace,'eslint.config.mjs'),rootLintSource=await readFile(rootLint,'utf8');
await writeFile(rootLint,"import { workspaceConfig, defaultDepConstraints } from '@mpfrontend/workspace-config/eslint';\n\nexport default [\n  ...workspaceConfig({\n    depConstraints: defaultDepConstraints.map((constraint) =>\n      constraint.sourceTag === 'type:app' ? { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['*'] } : constraint,\n    ),\n  }),\n];\n");
await run('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache']);
await writeFile(rootLint,rootLintSource);await rm(crossAppProbe);await rm(otherAppCode,{recursive:true});
await run('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache']);
console.log(JSON.stringify({stage:'boundary-tag-constraint',ok:true,refusedWithConstraint:'type:app may depend only on type:package',acceptedWithoutConstraint:true}));
// Negative controls of the catalog check: a key that no code uses, a key that code asks for and the base lacks,
// a registered locale without a catalog and a catalog without a key of the base each fail it. The fixture locale is registered for the control only, and
// the app is then restored.
const catalogPath=join(workspace,'apps/sample/src/i18n/messages/en.ts'),catalogSource=await readFile(catalogPath,'utf8');
const sampleConfigPath=join(workspace,'apps/sample/src/config/app.ts'),sampleConfig=await readFile(sampleConfigPath,'utf8');
const incompleteCatalog=join(workspace,'apps/sample/src/i18n/messages/'+RTL+'.ts');
await writeFile(catalogPath,catalogSource.replace("skipToContent: 'Skip to content',","skipToContent: 'Skip to content',\n  neverUsed: 'Never used',"));
const withFixture=sampleConfig.replace("locales: { en: { direction: 'ltr' } },","locales: { en: { direction: 'ltr' }, '"+RTL+"': { direction: 'rtl' } },");
assert.notEqual(withFixture,sampleConfig);await writeFile(sampleConfigPath,withFixture);
await writeFile(incompleteCatalog,"export default { skipToContent: '"+MARK+"Skip to content' };\n");
const undefinedKeyProbe=join(workspace,'apps/sample/src/app/undefined-key-probe.ts');
await writeFile(undefinedKeyProbe,"import { appMessages } from '../i18n';\nconst t = appMessages.translator('en') as unknown as (key: string) => string;\nexport const probe = t('neverDefined');\n");
const catalogFailure=await run('pnpm',['exec','mpfrontend','catalog','check','--app','apps/sample','--json'],{expectedCode:3,capture:true});
const catalogCodes=['UNUSED_KEY','UNDEFINED_KEY','MISSING_KEY','MISSING_LOCALE'];
for(const code of catalogCodes)assert.ok(catalogFailure.includes('"'+code+'"'),'CATALOG_NEGATIVE_CONTROL_MISSING:'+code);
await writeFile(catalogPath,catalogSource);await writeFile(sampleConfigPath,sampleConfig);await rm(incompleteCatalog);await rm(undefinedKeyProbe);
assert.equal(JSON.parse(await run('pnpm',['exec','mpfrontend','catalog','check','--app','apps/sample','--json'],{capture:true})).ok,true);
console.log(JSON.stringify({stage:'catalog-negative-control',ok:true,observedFailures:catalogCodes}));
const {parseRead}=await import(join(workspace,'apps/sample/src/api/generated/catalog/read-models.gen.ts'));
const valid={items:[{name:'Consumer fixture'}],number:1,size:12,total:1,pageCount:1,hasMore:false};
assert.equal(parseRead('catalog',valid),valid);
for(const invalid of [{...valid,items:[{}]},{...valid,number:'1'},{...valid,hasMore:null}])assert.throws(()=>parseRead('catalog',invalid),/INVALID_API_RESPONSE/);
assert.throws(()=>parseRead('constructor',{}),/INVALID_API_RESPONSE/);
assert.equal(parseRead('submission',{id:'b50c40a4-fb7b-4ea1-926f-fc9e3df50d25'}).id,'b50c40a4-fb7b-4ea1-926f-fc9e3df50d25');
assert.equal(parseRead('reporting',undefined),undefined);
for(const invalid of [{},null,'',[],false,0])assert.throws(()=>parseRead('reporting',invalid),/INVALID_API_RESPONSE/);
const {parseRequest}=await import(join(workspace,'apps/sample/src/api/generated/catalog/request-models.gen.ts'));
const request={name:'Example',quantity:1,approved:false};assert.equal(parseRequest('submission',request),request);
assert.equal(parseRequest('submission',{...request,approved:true}).approved,true);
for(const invalid of [{...request,quantity:'1'},{...request,quantity:0},{...request,name:'x'},{...request,serverId:'not-owned'},{...request,extra:true}])assert.throws(()=>parseRequest('submission',invalid),/INVALID_API_REQUEST/);
assert.throws(()=>parseRequest('constructor',{}),/INVALID_API_REQUEST/);
assert.equal(parseRequest('remove-submission',undefined),undefined);
for(const invalid of [{},null,'',[],false])assert.throws(()=>parseRequest('remove-submission',invalid),/INVALID_API_REQUEST/);
for(const valid of [undefined,null,{note:null},{note:'consumer request'}])assert.deepEqual(parseRequest('cancel-submission',valid),valid);
for(const invalid of [{},{note:3},{note:null,extra:true},'',[],false])assert.throws(()=>parseRequest('cancel-submission',invalid),/INVALID_API_REQUEST/);
// This imports the installed package, not checkout UI: required JSON false is not mandatory consent.
const {ResourceForm}=await import(join(workspace,'apps/sample/node_modules/@mpfrontend/ui/dist/index.js'));
const {createElement}=await import(join(workspace,'apps/sample/node_modules/react/index.js'));
const {renderToStaticMarkup}=await import(join(workspace,'apps/sample/node_modules/react-dom/server.node.js'));
const {requests}=await import(join(workspace,'apps/sample/src/api/generated/catalog/requests.gen.ts'));
const markup=renderToStaticMarkup(createElement(ResourceForm,{fields:requests.find(r=>r.name==='submission').fields,values:request,saveLabel:'Validate',onChange:()=>{},onSubmit:()=>{}}));
const booleanInput=markup.match(/<input[^>]*name="approved"[^>]*>/)?.[0];
assert.ok(booleanInput);assert.ok(!/\srequired(?:=|\s|>)/.test(booleanInput));assert.ok(!/\schecked(?:=|\s|>)/.test(booleanInput));
const generated=await readFile(join(workspace,'apps/sample/src/api/generated/catalog/resources.gen.ts'),'utf8');
assert.ok(generated.includes('catalog'));
await writeFile(join(workspace,'apps/sample/src/api/generated/catalog/resources.gen.ts'),generated+'\n');
await run('pnpm',['exec','ftg','check','--config','apps/sample/ftg.config.json'],{expectedCode:3});
await run('pnpm',['exec','ftg','generate','--config','apps/sample/ftg.config.json']);
await run('pnpm',['exec','ftg','check','--config','apps/sample/ftg.config.json']);
assert.equal(await readFile(overridePath,'utf8'),authored);
const project=JSON.parse(await readFile(join(workspace,'apps/sample/project.json'),'utf8'));
assert.deepEqual(project.implicitDependencies,['fixture-foundation']);
assert.equal((await import(join(foundation,'dist/index.js'))).fixtureFoundation,'Consumer-owned foundation');
const appManifest=await readFile(join(workspace,'apps/sample/package.json'),'utf8');
assert.ok(!appManifest.includes(root));
assert.ok((await readFile(join(workspace,'apps/sample/runtime-assets/swagger/swagger-ui-bundle.js'),'utf8')).length>1000);
console.log(JSON.stringify({ok:true,profile:'fresh-independent-packed-consumer',workspace,reportedVersion,
  dependencyAudit:onlineAudit?'passed':'not-run',
  checks:['actual-executable-cohort-version','two-mode-init/public-template-refusal','init-dry-run/destination-refusal','eighteen-workflow-dual-agent-install','design-source-attach/status','seven-packed-design-lifecycle-commands/synthetic-review/refusal','skills-drift/collision-refusal','existing-destination-refusal','authored-preservation','frozen-install',
    ...(onlineAudit?['dependency-audit']:[]),'packed-security-refresh-outage/12-tests','packed-browser-recovery/5-tests','packed-realtime-admission-floor/60750ms','nx-build/clean-dependent-library-order','typecheck','workspace-check/format-lint-typecheck-test-build-generated','lint-negative/app-import-raw-colour-handwritten-css-feature-entry-literal-text-physical-side-in-class-name-and-stylesheet','feature-route-package-generators/dry-run/refusal/formatted','built-css/tailwind-structural-classes/theme-after-fallback','served-english-default/fixture-locale-not-built-in/unknown-locale-default','product-only-rtl-locale/no-english-fallback/generator-follows-registry','catalog-check/negative-control','request-client-route-bundle','explicit-202/read-request-validation','explicit-204/empty-response-validation','explicit-bodyless/undefined-only-validation','explicit-optional-json/absent-null-object-validation','required-boolean-false','ftg-negative-drift','prepared-swagger-assets']}));
// The check removes its own temporary area when it passes; a failure stops before this line and leaves it, at the
// path printed first, for diagnosis. No other file is deleted.
await rm(temporary,{recursive:true,force:true});
