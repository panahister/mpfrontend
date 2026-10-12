import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {branchProblems,distTag,cohortProblems,readCohort,unpublishedProblems,registryVersion,publishPlan,publishOrder,
  integrityOf,recordMarkdown,unreleasedChanges,sumsText,selfTest} from './release.mjs';
import {apiReport,compareReports,policyProblems} from './api-report.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const {declared}=await readCohort(root);
// A copy of exactly the files the cohort guard reads, where a test can plant a wrong value.
async function cohortCopy(){
  const copy=await mkdtemp(join(tmpdir(),'mpfrontend-cohort-'));
  for(const path of ['package.json','packages/nx-plugin/templates/next/package.json.template','packages/nx-plugin/src/workspace.ts','packages/ai-skills/src/index.ts'])
    await cp(join(root,path),join(copy,path));
  await cp(join(root,'packages/ai-skills/skills'),join(copy,'packages/ai-skills/skills'),{recursive:true});
  for(const directory of await readdir(join(root,'packages'))){
    await mkdir(join(copy,'packages',directory),{recursive:true});
    await cp(join(root,'packages',directory,'package.json'),join(copy,'packages',directory,'package.json'));
  }
  return copy;
}
const edit=async(path,change)=>writeFile(path,change(await readFile(path,'utf8')));

test('a release runs from main only, and a prerelease never takes the latest dist-tag',()=>{
  assert.deepEqual(branchProblems('refs/heads/main'),[]);
  for(const ref of ['refs/heads/feature','refs/heads/main-copy','refs/tags/v1.0.0','refs/pull/7/merge',''])assert.equal(branchProblems(ref).length,1,ref);
  assert.equal(distTag('0.1.0'),'latest');assert.equal(distTag('0.2.0-rc.1'),'next');
  assert.throws(()=>distTag('0.1'),/INVALID_VERSION/);
});

test('the source is one cohort: every package, pin and procedure names the declared version',async()=>{
  assert.deepEqual(await cohortProblems(root,declared),[]);
  assert.match((await cohortProblems(root,declared+'1')).join(),/VERSION_NOT_DECLARED/);
  assert.match((await cohortProblems(root,'1.0')).join(),/INVALID_VERSION/);
});

test('a version or a pin that differs from the cohort, and missing registry metadata, are refused',async()=>{
  const copy=await cohortCopy();
  try{
    await edit(join(copy,'packages/ui/package.json'),text=>text.replace('"version": "'+declared+'"','"version": "'+declared+'-other"'));
    await edit(join(copy,'packages/nx-plugin/templates/next/package.json.template'),text=>text.replace('"@mpfrontend/i18n": "'+declared+'"','"@mpfrontend/i18n": "^'+declared+'"'));
    await edit(join(copy,'packages/ai-skills/skills/mpfrontend-scaffold-app/SKILL.md'),text=>text.replace('CLI `'+declared+'`','CLI `0.0.9`'));
    await edit(join(copy,'packages/nx-plugin/src/workspace.ts'),text=>text.replace("nxPlugin:'"+declared+"'","nxPlugin:'0.0.9'"));
    await edit(join(copy,'packages/tokens/package.json'),text=>JSON.stringify({...JSON.parse(text),publishConfig:{access:'restricted'}}));
    await edit(join(copy,'packages/access-react/package.json'),text=>JSON.stringify({...JSON.parse(text),dependencies:{'@mpfrontend/access-core':'0.0.9'}}));
    const problems=await cohortProblems(copy,declared);
    for(const expected of ['PACKAGE_VERSION:@mpfrontend/ui','TEMPLATE_PIN:@mpfrontend/i18n@^'+declared,'SKILL_PIN:mpfrontend-scaffold-app@0.0.9',
      'WORKSPACE_PIN:','PACKAGE_PUBLISH_CONFIG:@mpfrontend/tokens','PACKAGE_PIN:@mpfrontend/access-react:@mpfrontend/access-core@0.0.9'])
      assert.ok(problems.some(problem=>problem.startsWith(expected)),expected+' in '+problems.join(' '));
  }finally{await rm(copy,{recursive:true,force:true});}
});

test('a version the registry already holds, or a registry that does not answer, is refused before anything is built',async()=>{
  const names=['@mpfrontend/ui','@mpfrontend/tokens'];
  assert.deepEqual(await unpublishedProblems(names,declared,async()=>'absent'),[]);
  assert.deepEqual(await unpublishedProblems(names,declared,async name=>name==='@mpfrontend/ui'?{integrity:'sha512-x'}:'absent'),['VERSION_PUBLISHED:@mpfrontend/ui@'+declared]);
  assert.match((await unpublishedProblems(names,declared,async()=>{throw new Error('offline');})).join(),/REGISTRY_UNREACHABLE:@mpfrontend\/ui/);
  const answer=(status,body)=>async url=>{assert.equal(url,'https://registry.npmjs.org/@mpfrontend%2fui');return new Response(JSON.stringify(body),{status});};
  assert.equal(await registryVersion('@mpfrontend/ui',declared,{fetchImpl:answer(404,{})}),'absent');
  assert.equal(await registryVersion('@mpfrontend/ui',declared,{fetchImpl:answer(200,{versions:{'0.0.1':{}}})}),'absent');
  assert.deepEqual(await registryVersion('@mpfrontend/ui',declared,{fetchImpl:answer(200,{versions:{[declared]:{dist:{integrity:'sha512-a'}}}})}),{integrity:'sha512-a'});
  await assert.rejects(registryVersion('@mpfrontend/ui',declared,{fetchImpl:answer(503,{})}),/REGISTRY_ANSWER/);
});

test('a version is never published twice: the same bytes are skipped, other bytes are refused',async()=>{
  const record={packages:[{name:'@mpfrontend/a',version:'1.0.0',integrity:'sha512-a'},{name:'@mpfrontend/b',version:'1.0.0',integrity:'sha512-b'},{name:'@mpfrontend/c',version:'1.0.0',integrity:'sha512-c'}]};
  const states={'@mpfrontend/a':'absent','@mpfrontend/b':{integrity:'sha512-b'},'@mpfrontend/c':{integrity:'sha512-other'}};
  const {plan,problems}=await publishPlan(record,async name=>states[name]);
  assert.deepEqual(plan.map(entry=>entry.name+':'+entry.action),['@mpfrontend/a:publish','@mpfrontend/b:skip']);
  assert.deepEqual(problems,['VERSION_HOLDS_OTHER_BYTES:@mpfrontend/c@1.0.0']);
});

test('a package is published after the framework packages it depends on',async()=>{
  const order=publishOrder((await readCohort(root)).packages);
  assert.equal(order.length,16);
  for(const [before,after] of [['@mpfrontend/access-core','@mpfrontend/access-react'],['@mpfrontend/access-react','@mpfrontend/data-react'],
    ['@mpfrontend/ftg-core','@mpfrontend/ftg-cli'],['@mpfrontend/ai-skills','@mpfrontend/ftg-cli'],['@mpfrontend/nx-plugin','@mpfrontend/ftg-cli'],
    ['@mpfrontend/primitives','@mpfrontend/ui'],['@mpfrontend/i18n','@mpfrontend/security-bff']])
    assert.ok(order.indexOf(before)<order.indexOf(after),before+' before '+after);
});

test('the release record lists every archive with its SHA-256 and the integrity the registry records',()=>{
  assert.equal(integrityOf(Buffer.from('abc')),'sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==');
  const record={version:'0.1.0',commit:'a'.repeat(40),packages:[{name:'@mpfrontend/ui',version:'0.1.0',file:'mpfrontend-ui-0.1.0.tgz',sha256:'f'.repeat(64),integrity:'sha512-x'}]};
  assert.equal(sumsText(record),'f'.repeat(64)+'  mpfrontend-ui-0.1.0.tgz\n');
  const changes=unreleasedChanges('# Changelog\n\n## Unreleased\n\n| a | b |\n\n## 2026-10-12\n\nolder\n');
  assert.equal(changes,'| a | b |');
  const markdown=recordMarkdown(record,changes);
  for(const part of ['# Release 0.1.0','`'+'a'.repeat(40)+'`','| `@mpfrontend/ui` | `0.1.0` | `mpfrontend-ui-0.1.0.tgz` | `'+'f'.repeat(64)+'` | `sha512-x` |','## Changes\n\n| a | b |'])
    assert.ok(markdown.includes(part),part);
});

test('every guard of the workflow refuses its seeded input in the self-test it runs',async()=>{
  assert.deepEqual(await selfTest(root),[]);
});

const report=(version,entries)=>({schemaVersion:1,package:'@mpfrontend/x',version,entries});
test('the API policy: a change needs a new version, and a break a new minor version while the major is 0',()=>{
  const base=report('0.1.0',{'.':{a:'export declare const a: string;',b:'export declare function b(): void;'},'./styles.css':{file:'./src/styles.css'}});
  const added=entries=>({...entries,'.':{...entries['.'],c:'export declare const c: number;'}});
  const removed=entries=>({...entries,'.':{a:entries['.'].a}});
  const changed=entries=>({...entries,'.':{...entries['.'],b:'export declare function b(x: string): void;'}});
  assert.deepEqual(compareReports(base,report('0.1.0',added(base.entries))),{added:['. c'],removed:[],changed:[]});
  assert.deepEqual(compareReports(base,report('0.1.0',removed(base.entries))).removed,['. b']);assert.deepEqual(compareReports(base,report('0.1.0',changed(base.entries))).changed,['. b']);
  assert.deepEqual(policyProblems(base,report('0.1.0',base.entries)),[]);
  assert.match(policyProblems(base,report('0.1.0',added(base.entries))).join(),/API_CHANGED_WITHOUT_NEW_VERSION/);
  assert.deepEqual(policyProblems(base,report('0.1.1',added(base.entries))),[]);
  assert.match(policyProblems(base,report('0.1.1',removed(base.entries))).join(),/API_BREAK_NEEDS_MINOR/);
  assert.match(policyProblems(base,report('0.1.1',changed(base.entries))).join(),/API_BREAK_NEEDS_MINOR/);
  assert.match(policyProblems(base,report('0.1.1',{'.':base.entries['.']})).join(),/API_BREAK_NEEDS_MINOR/,'a removed entry point breaks');
  assert.deepEqual(policyProblems(base,report('0.2.0',removed(base.entries))),[]);
  assert.match(policyProblems(base,report('0.0.9',added(base.entries))).join(),/API_CHANGED_WITHOUT_NEW_VERSION/);
  const stable=report('1.2.0',base.entries);
  assert.match(policyProblems(stable,report('1.3.0',removed(base.entries))).join(),/API_BREAK_NEEDS_MAJOR/);
  assert.deepEqual(policyProblems(stable,report('2.0.0',removed(base.entries))),[]);
});

test('the API report holds every export of every entry point, from the built declarations',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-api-report-'));
  try{
    await mkdir(join(directory,'dist'));
    await writeFile(join(directory,'dist/index.d.ts'),"export {inner as renamed} from './inner.js';\n/** Documentation is not API. */\nexport declare const value: number;\nexport type Shape = { a: string };\n");
    await writeFile(join(directory,'dist/inner.d.ts'),'export declare function inner(input: string): number;\n');
    await writeFile(join(directory,'dist/server.d.ts'),'export declare class Store { private secret; read(): string; }\n');
    const manifest={name:'@mpfrontend/x',version:'0.1.0',exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'},'./server':{types:'./dist/server.d.ts',browser:'./dist/refusal.js',import:'./dist/server.js'},'./styles.css':'./src/styles.css'}};
    assert.deepEqual(apiReport(directory,manifest).entries,{
      '.':{Shape:'export type Shape = { a: string; };',renamed:'export declare function inner(input: string): number;',value:'export declare const value: number;'},
      './server':{Store:'export declare class Store { private secret; read(): string; }'},
      './styles.css':{file:'./src/styles.css'},
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
