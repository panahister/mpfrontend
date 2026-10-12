// The guards, the record and the publication of a release of the cohort. `.github/workflows/release.yml` runs them;
// docs/RELEASE-GUIDE.md explains the procedure. Nothing here publishes unless the publish command is run, and the
// workflow runs that command only on main, in the npm environment, after the owner approves the job.
import {readFile,readdir,mkdtemp,cp,writeFile,rm,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const REGISTRY='https://registry.npmjs.org';
const SEMVER=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));

/** A release is built and published from main only. */
export function branchProblems(ref){
  return ref==='refs/heads/main'?[]:['RELEASE_BRANCH_NOT_MAIN:'+ref];
}
export function parseVersion(version){
  const match=SEMVER.exec(version);
  if(!match)return undefined;
  return {major:Number(match[1]),minor:Number(match[2]),patch:Number(match[3]),prerelease:match[4]};
}
/** A prerelease never takes the latest dist-tag. */
export function distTag(version){
  const parsed=parseVersion(version);
  if(!parsed)throw new Error('INVALID_VERSION:'+version);
  return parsed.prerelease===undefined?'latest':'next';
}

/** The declared cohort version and every package of the cohort, from the source. */
export async function readCohort(root=defaultRoot){
  const declared=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
  const packages=[];
  for(const directory of (await readdir(join(root,'packages'))).sort()){
    const manifest=JSON.parse(await readFile(join(root,'packages',directory,'package.json'),'utf8'));
    packages.push({directory,name:manifest.name,version:manifest.version,manifest});
  }
  return {declared,packages};
}

/**
 * The problems of the cohort for the asked version: a version that is not the declared one, a package at another
 * version, a pin of a framework package anywhere that differs from it, and package metadata the registry needs.
 */
export async function cohortProblems(root,asked){
  const problems=[];
  if(!parseVersion(asked))problems.push('INVALID_VERSION:'+asked);
  const {declared,packages}=await readCohort(root);
  if(declared!==asked)problems.push('VERSION_NOT_DECLARED:'+asked+':declared:'+declared);
  for(const {name,version,manifest} of packages){
    if(!name?.startsWith('@mpfrontend/'))problems.push('PACKAGE_SCOPE:'+name);
    if(version!==declared)problems.push('PACKAGE_VERSION:'+name+'@'+version);
    for(const field of ['dependencies','peerDependencies','devDependencies'])for(const [dependency,pin] of Object.entries(manifest[field]??{}))
      if(dependency.startsWith('@mpfrontend/')&&pin!=='workspace:*'&&pin!==declared)problems.push('PACKAGE_PIN:'+name+':'+dependency+'@'+pin);
    if(manifest.license!=='Apache-2.0')problems.push('PACKAGE_LICENSE:'+name);
    if(manifest.repository?.url!=='git+https://github.com/panahister/mpfrontend.git'||manifest.repository?.directory!=='packages/'+name.slice('@mpfrontend/'.length))
      problems.push('PACKAGE_REPOSITORY:'+name);
    if(manifest.publishConfig?.access!=='public'||manifest.publishConfig?.provenance!==true)problems.push('PACKAGE_PUBLISH_CONFIG:'+name);
    if(manifest.private)problems.push('PACKAGE_PRIVATE:'+name);
  }
  const template=JSON.parse(await readFile(join(root,'packages/nx-plugin/templates/next/package.json.template'),'utf8'));
  for(const [dependency,pin] of Object.entries(template.dependencies??{}))
    if(dependency.startsWith('@mpfrontend/')&&pin!==declared)problems.push('TEMPLATE_PIN:'+dependency+'@'+pin);
  const workspace=await readFile(join(root,'packages/nx-plugin/src/workspace.ts'),'utf8');
  const cohort=/COHORT=\{cli:'([^']*)',nxPlugin:'([^']*)',workspaceConfig:'([^']*)'\}/.exec(workspace);
  if(!cohort||cohort.slice(1).some(pin=>pin!==declared))problems.push('WORKSPACE_PIN:'+(cohort?cohort.slice(1).join(','):'missing'));
  const skills=await readFile(join(root,'packages/ai-skills/src/index.ts'),'utf8');
  const skillVersions=/SKILLS_VERSION='([^']*)',SKILLS_CLI_VERSION='([^']*)'/.exec(skills);
  if(!skillVersions||skillVersions.slice(1).some(pin=>pin!==declared))problems.push('SKILLS_PIN:'+(skillVersions?skillVersions.slice(1).join(','):'missing'));
  for(const skill of (await readdir(join(root,'packages/ai-skills/skills'))).sort()){
    const text=await readFile(join(root,'packages/ai-skills/skills',skill,'SKILL.md'),'utf8');
    for(const match of text.matchAll(/CLI `?(\d+\.\d+\.\d+[0-9A-Za-z.-]*|dev\.\d+)`?/g))if(match[1]!==declared)problems.push('SKILL_PIN:'+skill+'@'+match[1]);
  }
  return problems;
}

/** Whether the registry holds a version of a package: 'absent', or its integrity. Any other answer throws. */
export async function registryVersion(name,version,{registry=REGISTRY,fetchImpl=fetch}={}){
  const response=await fetchImpl(registry.replace(/\/$/,'')+'/'+name.replace('/','%2f'),{headers:{accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(response.status===404)return 'absent';
  if(response.status!==200)throw new Error('REGISTRY_ANSWER:'+name+':'+response.status);
  const metadata=await response.json();
  const entry=metadata.versions?.[version];
  return entry?{integrity:entry.dist?.integrity}:'absent';
}
/** A version the registry already holds is refused before anything is built; an unreachable registry refuses too. */
export async function unpublishedProblems(names,version,lookup){
  const problems=[];
  for(const name of names){
    try{if(await lookup(name,version)!=='absent')problems.push('VERSION_PUBLISHED:'+name+'@'+version);}
    catch(error){problems.push('REGISTRY_UNREACHABLE:'+name+':'+error.message);}
  }
  return problems;
}

/** The SRI integrity that the registry records for an archive. */
export const integrityOf=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
/** The record of a release: every archive with its version, SHA-256 and integrity, and the commit it was built from. */
export async function releaseRecord(root,version,commit){
  const directory=join(root,'artifacts/packages');
  const inventory=JSON.parse(await readFile(join(directory,'inventory.json'),'utf8'));
  const packages=[];
  for(const entry of inventory.packages){
    if(entry.version!==version)throw new Error('RECORD_VERSION:'+entry.name+'@'+entry.version);
    const bytes=await readFile(join(directory,entry.file));
    const sha256=createHash('sha256').update(bytes).digest('hex');
    if(sha256!==entry.sha256)throw new Error('RECORD_DIGEST:'+entry.file);
    packages.push({name:entry.name,version:entry.version,file:entry.file,sha256,integrity:integrityOf(bytes)});
  }
  return {schemaVersion:1,version,commit,packages:packages.sort((a,b)=>a.name.localeCompare(b.name))};
}
export const sumsText=record=>record.packages.map(entry=>entry.sha256+'  '+entry.file).join('\n')+'\n';
/** The body of the section of CHANGELOG.md whose heading starts with `## <title>`, or undefined. */
function section(changelog,title){
  const heading=changelog.split('\n').findIndex(line=>line===('## '+title)||line.startsWith('## '+title+' '));
  if(heading<0)return undefined;
  const rest=changelog.split('\n').slice(heading+1),end=rest.findIndex(line=>line.startsWith('## '));
  return (end<0?rest:rest.slice(0,end)).join('\n').trim();
}
/** The changes of the release: the section `## <version>` of CHANGELOG.md, else its Unreleased section. */
export function releaseChanges(changelog,version){
  return section(changelog,version)??section(changelog,'Unreleased')??'';
}
export const unreleasedChanges=changelog=>releaseChanges(changelog,'Unreleased');
export function recordMarkdown(record,changes){
  return ['# Release '+record.version,'',
    'Sixteen archives published to the public npm registry under `@mpfrontend`, built from commit `'+record.commit+'` on main by',
    'the release workflow. A published version is never rebuilt with different bytes. `integrity` is what the registry',
    'records for the archive; `npm audit signatures` checks its registry signature and provenance.','',
    '| Package | Version | Archive | SHA-256 | Integrity |','|---|---|---|---|---|',
    ...record.packages.map(entry=>'| `'+entry.name+'` | `'+entry.version+'` | `'+entry.file+'` | `'+entry.sha256+'` | `'+entry.integrity+'` |'),'',
    'To check archives of this release, save this block as `SHA256SUMS.txt` beside them and run `shasum -a 256 -c SHA256SUMS.txt`:','',
    '```text',sumsText(record).trimEnd(),'```','','## Changes','',changes,''].join('\n');
}

/**
 * The arguments of `npm publish` for one archive. npm reads a path that does not start with "./" or "/" as the
 * shorthand "<user>/<repository>" of a GitHub repository and asks git for it, so the archive is given by an absolute path.
 */
export function publishArguments(directory,file,tag){
  return ['publish',resolve(directory,file),'--access','public','--provenance','--tag',tag];
}

const atLeast=(version,minimum)=>{
  const have=version.split('.').map(Number),need=minimum.split('.').map(Number);
  for(let index=0;index<3;index++)if((have[index]??0)!==need[index])return (have[index]??0)>need[index];
  return true;
};
/** What npm's page on trusted publishing requires of the job: npm CLI 11.5.1 or later and Node 22.14.0 or later. */
export function trustedPublishingProblems(npm,node){
  const problems=[];
  if(!atLeast(npm,'11.5.1'))problems.push('NPM_TOO_OLD:'+npm+' (trusted publishing needs 11.5.1 or later)');
  if(!atLeast(node,'22.14.0'))problems.push('NODE_TOO_OLD:'+node+' (trusted publishing needs 22.14.0 or later)');
  return problems;
}
/**
 * The workflow publishes with the OpenID Connect token of its job and holds no npm token: an empty token that the
 * environment passes could be used by npm instead of that identity. It also keeps the grant and the environment
 * that trusted publishing names.
 */
export function workflowTokenProblems(workflow){
  const code=workflow.split('\n').filter(line=>!/^\s*#/.test(line)).join('\n'),problems=[];
  if(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/.test(code))problems.push('WORKFLOW_HOLDS_A_TOKEN');
  if(!/^\s+id-token: write\b/m.test(code))problems.push('WORKFLOW_WITHOUT_OIDC_GRANT');
  if(!/^\s+environment: npm\s*$/m.test(code))problems.push('WORKFLOW_WITHOUT_ENVIRONMENT');
  return problems;
}

/** The order of publication: a package after the framework packages it depends on. */
export function publishOrder(packages){
  const names=new Set(packages.map(entry=>entry.name)),done=new Set(),order=[];
  const dependencies=entry=>Object.keys(entry.manifest.dependencies??{}).filter(name=>names.has(name));
  const visit=(entry,path=[])=>{
    if(done.has(entry.name))return;
    if(path.includes(entry.name))throw new Error('PACKAGE_CYCLE:'+[...path,entry.name].join('>'));
    for(const name of dependencies(entry))visit(packages.find(other=>other.name===name),[...path,entry.name]);
    done.add(entry.name);order.push(entry.name);
  };
  for(const entry of [...packages].sort((a,b)=>a.name.localeCompare(b.name)))visit(entry);
  return order;
}
/**
 * What to do with each archive: publish it, or skip it when the registry already holds these very bytes (a run that
 * stopped half way). The registry holding other bytes under the version is refused: a version is never published twice.
 */
export async function publishPlan(record,lookup){
  const plan=[],problems=[];
  for(const entry of record.packages){
    const state=await lookup(entry.name,entry.version);
    if(state==='absent')plan.push({...entry,action:'publish'});
    else if(state.integrity===entry.integrity)plan.push({...entry,action:'skip'});
    else problems.push('VERSION_HOLDS_OTHER_BYTES:'+entry.name+'@'+entry.version);
  }
  return {plan,problems};
}

/** Each guard refuses a seeded bad input; a guard that lets one through fails the run. */
export async function selfTest(root=defaultRoot){
  const failures=[];
  if(!branchProblems('refs/heads/feature').length||!branchProblems('refs/tags/v1.0.0').length||branchProblems('refs/heads/main').length)failures.push('branch guard');
  if(distTag('1.0.0-rc.1')!=='next'||distTag('1.0.0')!=='latest')failures.push('dist-tag');
  const {declared}=await readCohort(root);
  const copy=await mkdtemp(join(tmpdir(),'mpfrontend-release-self-test-'));
  try{
    for(const path of ['package.json','packages/nx-plugin/templates/next/package.json.template','packages/nx-plugin/src/workspace.ts','packages/ai-skills/src/index.ts'])
      await cp(join(root,path),join(copy,path),{recursive:true});
    await cp(join(root,'packages/ai-skills/skills'),join(copy,'packages/ai-skills/skills'),{recursive:true});
    for(const directory of await readdir(join(root,'packages'))){
      await mkdir(join(copy,'packages',directory),{recursive:true});
      await cp(join(root,'packages',directory,'package.json'),join(copy,'packages',directory,'package.json'));
    }
    if((await cohortProblems(copy,declared)).length)failures.push('cohort guard refuses the source itself');
    const template=join(copy,'packages/nx-plugin/templates/next/package.json.template');
    const original=await readFile(template,'utf8');
    await writeFile(template,original.replace('"@mpfrontend/ui": "'+declared+'"','"@mpfrontend/ui": "'+declared+'-other"'));
    if(!(await cohortProblems(copy,declared)).some(problem=>problem.startsWith('TEMPLATE_PIN:')))failures.push('cohort guard: a template pin');
    await writeFile(template,original);
    if(!(await cohortProblems(copy,declared+'1')).some(problem=>problem.startsWith('VERSION_NOT_DECLARED:')))failures.push('cohort guard: an undeclared version');
  }finally{await rm(copy,{recursive:true,force:true});}
  if(!(await unpublishedProblems(['@mpfrontend/ui'],declared,async()=>({integrity:'sha512-x'}))).length)failures.push('registry guard: a published version');
  if(!(await unpublishedProblems(['@mpfrontend/ui'],declared,async()=>{throw new Error('offline');})).length)failures.push('registry guard: an unreachable registry');
  if(!trustedPublishingProblems('11.5.0','24.19.0').length||!trustedPublishingProblems('11.6.0','22.13.9').length||trustedPublishingProblems('11.5.1','22.14.0').length)failures.push('toolchain guard');
  if(!workflowTokenProblems('env:\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}\n').length)failures.push('token guard: a token in the workflow');
  if(workflowTokenProblems(await readFile(join(root,'.github/workflows/release.yml'),'utf8')).length)failures.push('token guard refuses the workflow itself');
  const record={packages:[{name:'@mpfrontend/ui',version:declared,integrity:'sha512-a'}]};
  if(!(await publishPlan(record,async()=>({integrity:'sha512-b'}))).problems.length)failures.push('publish guard: other bytes under the version');
  return failures;
}

const run=(command,args,options={})=>new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:'inherit',...options});
  child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(command+' '+args.join(' ')+' exited '+code)));
});
function option(args,name){const index=args.indexOf('--'+name);return index<0?undefined:args[index+1];}
async function main(args){
  const [command]=args,root=defaultRoot;
  const fail=problems=>{if(problems.length){console.error(problems.join('\n'));process.exit(1);}};
  if(command==='guard'){
    const version=option(args,'version'),ref=option(args,'ref');
    if(!version||!ref)throw new Error('USAGE: guard --version <v> --ref <git ref> [--publish]');
    const problems=[...(args.includes('--publish')?branchProblems(ref):[]),...await cohortProblems(root,version),
      ...workflowTokenProblems(await readFile(join(root,'.github/workflows/release.yml'),'utf8'))];
    const {packages}=await readCohort(root);
    problems.push(...await unpublishedProblems(packages.map(entry=>entry.name),version,(name,v)=>registryVersion(name,v)));
    fail(problems);
    console.log(JSON.stringify({ok:true,version,ref,distTag:distTag(version),packages:packages.length,registry:'version absent'}));
  }else if(command==='self-test'){
    const failures=await selfTest(root);
    if(failures.length){console.error('GUARD_SELF_TEST_FAILED: '+failures.join(', '));process.exit(1);}
    console.log(JSON.stringify({ok:true,selfTest:'every guard refused its seeded input'}));
  }else if(command==='toolchain'){
    // The job that publishes by trusted publishing: the npm and the Node it runs, against npm's stated minimums.
    const npm=(await promisify(execFile)('npm',['--version'])).stdout.trim();
    fail(trustedPublishingProblems(npm,process.versions.node));
    console.log(JSON.stringify({ok:true,npm,node:process.versions.node}));
  }else if(command==='record'){
    const version=option(args,'version'),commit=option(args,'commit'),out=option(args,'out');
    if(!version||!/^[0-9a-f]{40}$/.test(commit??'')||!out)throw new Error('USAGE: record --version <v> --commit <sha> --out <dir>');
    const record=await releaseRecord(root,version,commit);
    await mkdir(out,{recursive:true});
    for(const entry of record.packages)await cp(join(root,'artifacts/packages',entry.file),join(out,entry.file));
    await writeFile(join(out,'release.json'),JSON.stringify(record,null,2)+'\n');
    await writeFile(join(out,'SHA256SUMS.txt'),sumsText(record));
    await writeFile(join(out,version+'.md'),recordMarkdown(record,releaseChanges(await readFile(join(root,'CHANGELOG.md'),'utf8'),version)));
    console.log(JSON.stringify({ok:true,version,commit,archives:record.packages.length}));
  }else if(command==='publish'){
    const directory=option(args,'dir'),ref=option(args,'ref');
    if(!directory||!ref)throw new Error('USAGE: publish --dir <release directory> --ref <git ref>');
    fail(branchProblems(ref));
    const record=JSON.parse(await readFile(join(directory,'release.json'),'utf8'));
    for(const entry of record.packages)if(integrityOf(await readFile(join(directory,entry.file)))!==entry.integrity)fail(['ARCHIVE_CHANGED:'+entry.file]);
    const {plan,problems}=await publishPlan(record,(name,version)=>registryVersion(name,version));
    fail(problems);
    const {packages}=await readCohort(root);
    const tag=distTag(record.version);
    for(const name of publishOrder(packages)){
      const entry=plan.find(item=>item.name===name);
      if(!entry)fail(['RECORD_MISSING:'+name]);
      if(entry.action==='skip'){console.log(JSON.stringify({package:name,version:entry.version,published:'already, the same bytes'}));continue;}
      await run('npm',publishArguments(directory,entry.file,tag));
      console.log(JSON.stringify({package:name,version:entry.version,published:true,tag}));
    }
  }else throw new Error('USAGE: release.mjs guard|self-test|toolchain|record|publish');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await main(process.argv.slice(2));
