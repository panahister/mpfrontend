// Install real packed packages into a fresh, independent Nx workspace. Never import platform source.
import {mkdtemp, readFile, writeFile, mkdir, cp, lstat, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,delimiter,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import assert from 'node:assert/strict';
import {parse,stringify} from 'yaml';
import {verifyDesignConsumer} from './design-consumer.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Advisory upload is an explicit opt-in; offline validation must never imply it ran.
const onlineAudit=process.argv.includes('--online-audit');
assert.ok(process.argv.slice(2).every(arg=>arg==='--online-audit'),'UNKNOWN_CONSUMER_OPTION');
// A nested pnpm/Nx invocation must not borrow executables from the source checkout's PATH.
const independentPath=(process.env.PATH??'').split(delimiter)
  .filter(path=>!path.includes('node_modules/.bin')).join(delimiter);
const temporary=await mkdtemp(join(tmpdir(),'mpfrontend-packed-consumer-'));
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
async function run(command,args,{expectedCode=0,cwd=workspace,capture=false}={}){
  return await new Promise((resolve,reject)=>{
    let output='';
    const child=spawn(command,args,{cwd,stdio:['ignore',capture?'pipe':'inherit','inherit'],env:{...process.env,PATH:independentPath,
      NX_DAEMON:'false',NX_ISOLATE_PLUGINS:'false',NEXT_TELEMETRY_DISABLED:'1',
      pnpm_config_verify_deps_before_run:'false'}});
    if(capture)child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1048576){child.kill();reject(new Error('CONSUMER_CAPTURE_TOO_LARGE'));}});
    child.on('error',reject);child.on('close',code=>code===expectedCode?resolve(output):reject(new Error('CONSUMER_COMMAND_FAILED:'+command+':'+code)));
  });
}
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
return <main><h1>Synthetic request preview</h1><p>{fixtureFoundation}</p><p>No API mutation is sent.</p><ResourceForm fields={requests[0]!.fields} values={values} saveLabel="Validate payload" onChange={(key,value)=>setValues(old=>({...old,[key]:value}))} onSubmit={()=>{try{setResult(JSON.stringify(parseRequest('submission',values)));}catch{setResult('Invalid fixture request');}}}/><p role="status">{result}</p></main>;}
`);
const overridePath=join(workspace,'apps/sample/src/features/catalog/model/overrides/index.ts');
const authored=(await readFile(overridePath,'utf8'))+'\n// Consumer-authored preservation sentinel.\n';
await writeFile(overridePath,authored);
await run('pnpm',['exec','mpfrontend','create','app','--name','sample','--directory','apps/sample'],{expectedCode:2});
assert.equal(await readFile(overridePath,'utf8'),authored);
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
await run('pnpm',['check','--skip-nx-cache']);
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
// The built app serves Persian right to left with logical CSS, and an unknown locale falls back to the
// default. The server binds a free loopback port and its BFF origin is a closed local port.
const port=await new Promise((resolve,reject)=>{const probe=createNetServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const value=probe.address().port;probe.close(()=>resolve(value));});});
const server=spawn(join(workspace,'apps/sample/node_modules/.bin/next'),['start','.','-p',String(port),'-H','127.0.0.1'],{cwd:join(workspace,'apps/sample'),detached:true,stdio:'ignore',
  env:{...process.env,PATH:independentPath,NEXT_TELEMETRY_DISABLED:'1',BFF_ORIGIN:'http://127.0.0.1:9'}});
try{
  const page=async locale=>{
    for(let attempt=0;attempt<120;attempt++){
      try{const response=await fetch('http://127.0.0.1:'+port+'/catalog',{headers:locale?{cookie:'sample_locale='+locale}:{}});if(response.ok)return await response.text();}catch{}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('APP_DID_NOT_START');
  };
  const persian=await page('fa');
  assert.match(persian,/<html lang="fa" dir="rtl"/);
  assert.match(persian,/focus:start-4/);assert.match(persian,/border-s-4/);
  assert.doesNotMatch(persian,/\b(?:ml|mr|pl|pr|left|right)-\d/);
  assert.match(await page('xx'),/<html lang="en" dir="ltr"/);
  assert.match(await page(),/<html lang="en" dir="ltr"/);
  console.log(JSON.stringify({stage:'served-locales',ok:true,fa:'rtl',unknown:'default-en'}));
}finally{try{process.kill(-server.pid,'SIGTERM');}catch{}}
// A build must not rewrite a formatted file (for example a framework editing the app tsconfig).
await run('pnpm',['run','format:check']);
// Negative controls of the profile: an app importing another app, a raw colour and hand-written CSS fail lint.
await run('pnpm',['exec','mpfrontend','create','app','--name','other','--directory','apps/other']);
const probes={'apps/sample/src/boundary-probe.ts':"import { appId } from '../../other/src/config/app';\nexport const probe = appId;\n",
  'apps/sample/src/app/entry-probe/page.tsx':"export { CatalogList as default } from '../../features/catalog/ui/catalog-list';\n",
  'apps/sample/src/colour-probe.tsx':'export const Probe = () => <p className="bg-[#123456]" />;\n',
  'apps/sample/src/probe.css':'.probe {\n  display: flex;\n}\n'};
for(const [path,content]of Object.entries(probes)){await mkdir(dirname(join(workspace,path)),{recursive:true});await writeFile(join(workspace,path),content);}
const lintFailure=await run('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache'],{expectedCode:1,capture:true});
const lintRules=['@nx/enforce-module-boundaries','mpfrontend/no-raw-color','mpfrontend/no-handwritten-css','mpfrontend/public-entry'];
for(const rule of lintRules)assert.ok(lintFailure.includes(rule),'LINT_NEGATIVE_CONTROL_MISSING:'+rule);
console.log(JSON.stringify({stage:'lint-negative-controls',ok:true,observedFailures:lintRules}));
for(const path of Object.keys(probes))await rm(join(workspace,path));
await rm(join(workspace,'apps/sample/src/app/entry-probe'),{recursive:true});
await run('pnpm',['exec','nx','run','sample:lint','--skip-nx-cache']);
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
    ...(onlineAudit?['dependency-audit']:[]),'packed-security-refresh-outage/12-tests','packed-browser-recovery/5-tests','packed-realtime-admission-floor/60750ms','nx-build/clean-dependent-library-order','typecheck','workspace-check/format-lint-typecheck-test-build-generated','lint-negative/app-import-raw-colour-handwritten-css-feature-entry','feature-route-package-generators/dry-run/refusal/formatted','built-css/tailwind-structural-classes/theme-after-fallback','served-fa-rtl/unknown-locale-default','request-client-route-bundle','explicit-202/read-request-validation','explicit-204/empty-response-validation','explicit-bodyless/undefined-only-validation','explicit-optional-json/absent-null-object-validation','required-boolean-false','ftg-negative-drift','prepared-swagger-assets']}));
// Keep the test-only generated workspace for diagnosis; no user files are deleted.
