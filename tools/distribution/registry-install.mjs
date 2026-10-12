// Installs the cohort from a registry into a freshly generated workspace and app, and checks that every framework
// package is the version and the bytes of the release record.
//
// Without options it proves this against throw-away local registries: it starts two registry containers of its own
// (an approved one and a decoy), publishes the packed archives to them and installs. Two seeded controls must fail:
// without the scope binding the decoy serves a framework package, and a range instead of an exact pin installs a
// newer version. It also reads the API of a published archive back from a registry. It removes its containers and
// temporary folders. It never sends anything to a public or remote registry.
//
// With --registry <url> --record <release.json> it checks a publication: the same install from that registry, then
// `npm audit signatures` over the cohort (registry signatures and provenance attestations).
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from 'yaml';
import {independentToolchain} from './toolchain.mjs';
import {integrityOf,parseVersion} from './release.mjs';
import {apiReport,publishedReport,policyProblems} from './api-report.mjs';

const exec=promisify(execFile);
const root=fileURLToPath(new URL('../../',import.meta.url));
const IMAGE='verdaccio/verdaccio:6.10.4';
const args=process.argv.slice(2);
const option=name=>{const index=args.indexOf('--'+name);return index<0?undefined:args[index+1];};

function run(command,commandArgs,{cwd,env,expectedCode=0,capture=false}){
  return new Promise((resolve,reject)=>{
    let output='';
    const child=spawn(command,commandArgs,{cwd,env,stdio:['ignore',capture?'pipe':'inherit',capture?'pipe':'inherit']});
    if(capture){child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});}
    child.on('error',reject);
    child.on('close',code=>code===expectedCode?resolve(output):reject(new Error('COMMAND_FAILED:'+command+' '+commandArgs.join(' ')+':'+code)));
  });
}

/** The @mpfrontend packages a pnpm lockfile resolved, with their versions and integrity. */
export function lockedFramework(lockfile){
  const packages=parse(lockfile).packages??{},result={};
  for(const [key,value] of Object.entries(packages)){
    const match=/^(@mpfrontend\/[a-z0-9-]+)@([^()]+)/.exec(key);
    if(match)result[match[1]+'@'+match[2]]={name:match[1],version:match[2],integrity:value.resolution?.integrity};
  }
  return Object.values(result);
}
/** The problems of an install against the release record: another version, other bytes, or a package missing. */
export function installProblems(locked,record,expected){
  const problems=[];
  const byName=new Map(record.packages.map(entry=>[entry.name,entry]));
  for(const entry of locked){
    const recorded=byName.get(entry.name);
    if(!recorded){problems.push('UNRECORDED_PACKAGE:'+entry.name);continue;}
    if(entry.version!==recorded.version)problems.push('VERSION_MISMATCH:'+entry.name+'@'+entry.version);
    else if(entry.integrity!==recorded.integrity)problems.push('INTEGRITY_MISMATCH:'+entry.name+'@'+entry.version);
  }
  for(const name of expected)if(!locked.some(entry=>entry.name===name))problems.push('NOT_INSTALLED:'+name);
  return problems;
}

async function setup(){
  const temporary=await mkdtemp(join(tmpdir(),'mpfrontend-registry-install-'));
  const toolchainPath=(await independentToolchain(join(temporary,'toolchain'))).path;
  const env={...process.env,PATH:toolchainPath,NX_DAEMON:'false',NX_ISOLATE_PLUGINS:'false',NEXT_TELEMETRY_DISABLED:'1',pnpm_config_verify_deps_before_run:'false'};
  return {temporary,env};
}

/**
 * A fresh bootstrap with the CLI from the scope's registry, a generated workspace and app, and an install. `npmrc`
 * replaces the lines of the generated .npmrc, so that a control can drop the scope binding.
 */
async function generateAndInstall({temporary,env},{name,version,scopeRegistry,defaultRegistry,npmrc,editApp}){
  const directory=join(temporary,name),bootstrap=join(directory,'bootstrap'),workspace=join(directory,'workspace');
  await mkdir(bootstrap,{recursive:true});
  const binding='@mpfrontend:registry='+scopeRegistry+'\n'+(defaultRegistry?'registry='+defaultRegistry+'\n':'');
  await writeFile(join(bootstrap,'.npmrc'),binding);
  const source=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  await writeFile(join(bootstrap,'package.json'),JSON.stringify({name:'registry-bootstrap',private:true,type:'module',
    packageManager:source.packageManager,dependencies:{'@mpfrontend/ftg-cli':version,nx:source.devDependencies.nx}},null,2));
  // A release that was published a moment ago must be installable by this check; the exception names only the scope.
  await writeFile(join(bootstrap,'pnpm-workspace.yaml'),'packages: []\nminimumReleaseAgeExclude:\n  - "@mpfrontend/*"\nallowBuilds:\n  nx: true\n');
  await run('pnpm',['install','--no-frozen-lockfile'],{cwd:bootstrap,env});
  await run('pnpm',['exec','mpfrontend','init','--name','registry-consumer','--directory',workspace,'--design-source','none','--json'],{cwd:bootstrap,env});
  const generated=await readFile(join(workspace,'.npmrc'),'utf8');
  assert.equal(generated,'@mpfrontend:registry=https://registry.npmjs.org/\nsave-exact=true\n','the generator binds the scope to the public registry');
  await writeFile(join(workspace,'.npmrc'),npmrc(generated,binding));
  const policy=await readFile(join(workspace,'pnpm-workspace.yaml'),'utf8');
  await writeFile(join(workspace,'pnpm-workspace.yaml'),policy+'minimumReleaseAgeExclude:\n  - "@mpfrontend/*"\n');
  await run(join(bootstrap,'node_modules/.bin/mpfrontend'),['create','app','--name','sample','--directory','apps/sample','--json'],{cwd:workspace,env});
  if(editApp){
    const path=join(workspace,'apps/sample/package.json');
    await writeFile(path,editApp(await readFile(path,'utf8')));
  }
  await run('pnpm',['install','--no-frozen-lockfile','--ignore-scripts'],{cwd:workspace,env});
  return {workspace,locked:lockedFramework(await readFile(join(workspace,'pnpm-lock.yaml'),'utf8'))};
}

async function local(){
  const inventory=JSON.parse(await readFile(join(root,'artifacts/packages/inventory.json'),'utf8'));
  const version=inventory.packages[0].version;
  const archives=join(root,'artifacts/packages');
  const record={version,packages:await Promise.all(inventory.packages.map(async entry=>({name:entry.name,version:entry.version,file:entry.file,
    integrity:integrityOf(await readFile(join(archives,entry.file)))})))};
  const context=await setup();
  const containers=[];
  try{
    // Two registries of this check only: the approved one and a decoy. Neither proxies the scope.
    const config=join(context.temporary,'config.yaml');
    await writeFile(config,"storage: /verdaccio/storage/data\nauth:\n  htpasswd:\n    file: /verdaccio/storage/htpasswd\n    max_users: -1\n"+
      "uplinks:\n  npmjs:\n    url: https://registry.npmjs.org/\npackages:\n  '@mpfrontend/*':\n    access: $all\n    publish: $anonymous\n"+
      "  '**':\n    access: $all\n    publish: $anonymous\n    proxy: npmjs\nlog: { type: stdout, format: pretty, level: warn }\n");
    const start=async role=>{
      const name='mpfrontend-registry-test-'+role+'-'+randomUUID().slice(0,8);
      await exec('docker',['run','-d','--name',name,'--label','mpfrontend.test=registry','-p','127.0.0.1::4873','-v',config+':/verdaccio/conf/config.yaml:ro',IMAGE],{timeout:60000});
      containers.push(name);
      const url='http://'+(await exec('docker',['port',name,'4873/tcp'])).stdout.trim().split('\n')[0]+'/';
      for(let attempt=0;attempt<120;attempt++){try{if((await fetch(url+'-/ping')).ok)return url;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
      throw new Error('REGISTRY_DID_NOT_START:'+role);
    };
    const approved=await start('approved'),decoy=await start('decoy');
    // Publication the way npm does it: the manifest with the archive attached, under the dist-tag latest.
    const publish=async(registry,bytes)=>{
      const unpack=await mkdtemp(join(context.temporary,'archive-'));
      await writeFile(join(unpack,'package.tgz'),bytes);await exec('tar',['-xzf',join(unpack,'package.tgz'),'-C',unpack]);
      const manifest=JSON.parse(await readFile(join(unpack,'package/package.json'),'utf8'));
      const file=manifest.name.replace('@','').replace('/','-')+'-'+manifest.version+'.tgz';
      const body={_id:manifest.name,name:manifest.name,'dist-tags':{latest:manifest.version},versions:{[manifest.version]:{...manifest,_id:manifest.name+'@'+manifest.version,
        dist:{tarball:registry+manifest.name+'/-/'+file,shasum:createHash('sha1').update(bytes).digest('hex'),integrity:integrityOf(bytes)}}},
        _attachments:{[file]:{content_type:'application/octet-stream',data:bytes.toString('base64'),length:bytes.length}}};
      const response=await fetch(registry+manifest.name.replace('/','%2f'),{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw new Error('LOCAL_PUBLISH_FAILED:'+manifest.name+':'+response.status+':'+await response.text());
    };
    // The same archive with one changed byte of content, or under another version.
    const variant=async(file,change)=>{
      const directory=await mkdtemp(join(context.temporary,'variant-'));
      await exec('tar',['-xzf',join(archives,file),'-C',directory]);
      await change(join(directory,'package'));
      await exec('tar',['-czf',join(directory,'variant.tgz'),'-C',directory,'package']);
      return readFile(join(directory,'variant.tgz'));
    };
    const ui=inventory.packages.find(entry=>entry.name==='@mpfrontend/ui');
    for(const entry of inventory.packages)await publish(approved,await readFile(join(archives,entry.file)));
    const [major,minor,patch]=version.split('-')[0].split('.').map(Number);
    const newer=major+'.'+minor+'.'+(patch+1);
    await publish(approved,await variant(ui.file,async directory=>{
      const path=join(directory,'package.json');await writeFile(path,(await readFile(path,'utf8')).replace('"version": "'+version+'"','"version": "'+newer+'"'));
    }));
    for(const entry of inventory.packages)await publish(decoy,entry.name===ui.name?await variant(ui.file,async directory=>{
      await writeFile(join(directory,'README.md'),(await readFile(join(directory,'README.md'),'utf8'))+'\nAnother publisher.\n');
    }):await readFile(join(archives,entry.file)));
    const expected=inventory.packages.filter(entry=>['ftg-cli','nx-plugin','workspace-config','access-core','access-react','app-layout','data-react','ftg-core','i18n','presentation-server','tokens','ui']
      .includes(entry.name.slice('@mpfrontend/'.length))).map(entry=>entry.name);
    const keepBinding=(generated,binding)=>generated.replace('@mpfrontend:registry=https://registry.npmjs.org/\n',binding);
    // The decoy is the default registry of the project; the scope binding still decides where @mpfrontend comes from.
    const bound=await generateAndInstall(context,{name:'bound',version,scopeRegistry:approved,defaultRegistry:decoy,npmrc:keepBinding});
    assert.deepEqual(installProblems(bound.locked,record,expected),[]);
    console.log(JSON.stringify({stage:'registry-install',ok:true,scope:'approved registry',frameworkPackages:bound.locked.length,exactVersions:version,integrity:'release record'}));
    const unbound=await generateAndInstall(context,{name:'unbound',version,scopeRegistry:approved,defaultRegistry:decoy,
      npmrc:(generated,binding)=>keepBinding(generated,binding).replace('@mpfrontend:registry='+approved+'\n','')});
    const unboundProblems=installProblems(unbound.locked,record,expected);
    assert.deepEqual(unboundProblems,['INTEGRITY_MISMATCH:@mpfrontend/ui@'+version],'without the binding the decoy serves the scope');
    console.log(JSON.stringify({stage:'registry-control-scope-binding',expectedFailure:true,observed:unboundProblems}));
    const ranged=await generateAndInstall(context,{name:'ranged',version,scopeRegistry:approved,defaultRegistry:decoy,npmrc:keepBinding,
      editApp:text=>text.replace('"@mpfrontend/ui": "'+version+'"','"@mpfrontend/ui": "^'+version+'"')});
    const rangedProblems=installProblems(ranged.locked,record,expected);
    assert.deepEqual(rangedProblems,['VERSION_MISMATCH:@mpfrontend/ui@'+newer],'a range installs the newer version');
    console.log(JSON.stringify({stage:'registry-control-exact-pin',expectedFailure:true,observed:rangedProblems}));
    // The API of a published archive, read back from the registry, is the baseline of the next release.
    const published=await publishedReport('@mpfrontend/tokens',{registry:approved});
    const current=apiReport(join(root,'packages/tokens'),JSON.parse(await readFile(join(root,'packages/tokens/package.json'),'utf8')));
    assert.deepEqual(policyProblems(published,current),[]);
    const removed={...current,version:newer,entries:{...current.entries,'.':Object.fromEntries(Object.entries(current.entries['.']).slice(1))}};
    // The policy of a major version of 0 asks a new minor version for a break; from 1.0.0 it asks a new major version.
    assert.match(policyProblems(published,removed).join(),parseVersion(published.version).major===0?/API_BREAK_NEEDS_MINOR/:/API_BREAK_NEEDS_MAJOR/);
    assert.match(policyProblems(published,{...removed,version}).join(),/API_CHANGED_WITHOUT_NEW_VERSION/);
    console.log(JSON.stringify({stage:'registry-api-baseline',ok:true,published:published.version,breakWithPatchRefused:true}));
  }finally{
    for(const name of containers)await exec('docker',['rm','-f','-v',name]).catch(()=>undefined);
    await rm(context.temporary,{recursive:true,force:true});
  }
}

async function published(registry,recordPath){
  const record=JSON.parse(await readFile(recordPath,'utf8'));
  const context=await setup();
  try{
    const result=await generateAndInstall(context,{name:'published',version:record.version,scopeRegistry:registry,npmrc:generated=>generated});
    const problems=installProblems(result.locked,record,[]);
    assert.deepEqual(problems,[]);
    // npm verifies the registry signature and the provenance attestation of each package it installed.
    const audit=join(context.temporary,'audit');await mkdir(audit);
    await writeFile(join(audit,'package.json'),JSON.stringify({name:'cohort-audit',private:true,dependencies:Object.fromEntries(record.packages.map(entry=>[entry.name,entry.version]))},null,2));
    await writeFile(join(audit,'.npmrc'),'@mpfrontend:registry='+registry+'\n');
    // The audit reads the sixteen archives as the registry served them; the peers (React, nuqs) are an app's own and
    // the generated app above installed them. npm would otherwise resolve this bare folder's missing peers and refuse
    // the cohort over an optional peer of nuqs. An npm consumer that declares its own react installs the cohort.
    await run('npm',['install','--ignore-scripts','--no-audit','--no-fund','--legacy-peer-deps'],{cwd:audit,env:context.env});
    const output=await run('npm',['audit','signatures','--json','--include-attestations'],{cwd:audit,env:context.env,capture:true});
    const report=JSON.parse(output.slice(output.indexOf('{')));
    assert.deepEqual(report.invalid??[],[]);assert.deepEqual(report.missing??[],[]);
    const attested=new Set((report.verified??[]).map(entry=>entry.name));
    for(const entry of record.packages)assert.ok(attested.has(entry.name),'PROVENANCE_NOT_VERIFIED:'+entry.name);
    console.log(JSON.stringify({stage:'published-cohort',ok:true,registry,version:record.version,packages:record.packages.length,signaturesAndProvenance:'verified'}));
  }finally{await rm(context.temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const registry=option('registry'),recordPath=option('record');
  if(registry||recordPath){
    if(!registry||!recordPath)throw new Error('USAGE: registry-install.mjs [--registry <url> --record <release.json>]');
    await published(registry,recordPath);
  }else await local();
}
