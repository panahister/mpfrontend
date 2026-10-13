import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,dirname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile as execFileCallback} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {branchProblems,distTag,cohortProblems,readCohort,unpublishedProblems,registryVersion,publishPlan,publishOrder,publishArguments,dryRunArguments,dryRunPublish,trustedPublishingProblems,workflowTokenProblems,
  integrityOf,recordMarkdown,unreleasedChanges,releaseChanges,sumsText,selfTest} from './release.mjs';
import {setCohortVersion} from './set-cohort-version.mjs';
import {apiReport,compareReports,policyProblems} from './api-report.mjs';

const execFile=promisify(execFileCallback);
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

test('an archive is given to npm publish by an absolute path, which npm cannot read as a GitHub repository',()=>{
  // npm reads "release/a.tgz" as the shorthand of the GitHub repository "release/a.tgz"; the first publication failed on it.
  const readsAsFile=spec=>isAbsolute(spec)||spec.startsWith('./');
  assert.equal(readsAsFile(join('release','a.tgz')),false,'the control: the path the first publication gave npm');
  const args=publishArguments('release','mpfrontend-a-1.0.0.tgz','latest');
  assert.equal(readsAsFile(args[1]),true);
  assert.ok(args[1].endsWith('/release/mpfrontend-a-1.0.0.tgz'));
  assert.deepEqual([args[0],...args.slice(2)],['publish','--access','public','--provenance','--tag','latest']);
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
  // The record reads the section of the version when the changelog has one, and the Unreleased section otherwise.
  const both='# Changelog\n\n## Unreleased\n\nnext\n\n## 0.1.1 (2026-10-20)\n\nthe release\n\n## 0.1.0\n\nolder\n';
  assert.equal(releaseChanges(both,'0.1.1'),'the release');
  assert.equal(releaseChanges(both,'0.1.2'),'next','a version without a section falls back to Unreleased');
  assert.equal(releaseChanges('# Changelog\n\n## 0.1.10\n\nother\n','0.1.1'),'','a longer version number is not the version');
  const markdown=recordMarkdown(record,changes);
  for(const part of ['# Release 0.1.0','`'+'a'.repeat(40)+'`','| `@mpfrontend/ui` | `0.1.0` | `mpfrontend-ui-0.1.0.tgz` | `'+'f'.repeat(64)+'` | `sha512-x` |','## Changes\n\n| a | b |'])
    assert.ok(markdown.includes(part),part);
});

test('the workflow publishes by trusted publishing: no npm token reaches a step, and the job keeps its grant and environment',async()=>{
  const workflow=await readFile(join(root,'.github/workflows/release.yml'),'utf8');
  assert.deepEqual(workflowTokenProblems(workflow),[]);
  // The controls: the step env of the first publication, an empty token passed by the environment, and a lost grant.
  const withToken=workflow.replace('run: node tools/distribution/release.mjs publish --dir release --ref "$GITHUB_REF"',
    'run: node tools/distribution/release.mjs publish --dir release --ref "$GITHUB_REF"\n        env:\n          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
  assert.notEqual(withToken,workflow);
  assert.deepEqual(workflowTokenProblems(withToken),['WORKFLOW_HOLDS_A_TOKEN']);
  assert.deepEqual(workflowTokenProblems(workflow.replace('id-token: write','id-token: none')),['WORKFLOW_WITHOUT_OIDC_GRANT']);
  assert.deepEqual(workflowTokenProblems(workflow.replace('environment: npm','environment: other')),['WORKFLOW_WITHOUT_ENVIRONMENT']);
  assert.deepEqual(workflowTokenProblems(workflow.replace('# No npm token is stored','# NODE_AUTH_TOKEN is not stored')),[],'a comment is not a token');
});

test('the rehearsal calls the command of the publication on one archive and publishes nothing',async()=>{
  const args=dryRunArguments('release','mpfrontend-a-1.0.0.tgz','latest');
  assert.ok(isAbsolute(args[1]),'the same absolute path as the publication');
  assert.deepEqual([args[0],...args.slice(2)],['publish','--access','public','--tag','latest','--dry-run']);
  assert.ok(!args.includes('--provenance'),'provenance needs the identity of the publishing job');
  // The real command, on a real archive: npm reads the path, packs it and prints the line it would publish; nothing is sent.
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-dry-run-'));
  try{
    await mkdir(join(directory,'package/dist'),{recursive:true});
    await writeFile(join(directory,'package/package.json'),JSON.stringify({name:'@mpfrontend/x',version:'1.0.0',exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}},publishConfig:{access:'public'}}));
    await writeFile(join(directory,'package/dist/index.js'),'export const a=1;\n');await writeFile(join(directory,'package/dist/index.d.ts'),'export declare const a: number;\n');
    await execFile('tar',['-czf',join(directory,'x.tgz'),'-C',directory,'package']);
    assert.match(await dryRunPublish(directory,'x.tgz','latest'),/\+ @mpfrontend\/x@1\.0\.0/);
    await assert.rejects(dryRunPublish(directory,'missing.tgz','latest'),/missing\.tgz|ENOENT|Command failed/,'an archive that is not there fails the dry run');
  }finally{await rm(directory,{recursive:true,force:true});}
  // The workflow makes the dry run in every run, before the archives are uploaded; the control: without the step it does not.
  const workflow=await readFile(join(root,'.github/workflows/release.yml'),'utf8');
  const step=/- name: A dry run of npm publish on one archive\n\s+run: node tools\/distribution\/release\.mjs dry-run --dir "artifacts\/release\/\$VERSION"/;
  assert.match(workflow,step);
  assert.ok(workflow.search(step)<workflow.indexOf('actions/upload-artifact@v7'),'before the upload');
  assert.doesNotMatch(workflow.replace(step,''),step);
});

test('npm CLI 11.5.1 and Node 22.14.0 are the least that publish by trusted publishing',()=>{
  assert.deepEqual(trustedPublishingProblems('11.5.1','22.14.0'),[]);
  assert.deepEqual(trustedPublishingProblems('11.17.0','24.19.0'),[]);
  assert.equal(trustedPublishingProblems('11.5.0','24.19.0').length,1);
  assert.equal(trustedPublishingProblems('10.9.2','24.19.0').length,1);
  assert.equal(trustedPublishingProblems('11.6.0','22.13.1').length,1);
  assert.equal(trustedPublishingProblems('9.0.0','20.0.0').length,2);
});

test('moving the cohort changes every place that names its version, and the guard then accepts the new version',async()=>{
  const copy=await mkdtemp(join(tmpdir(),'mpfrontend-set-version-'));
  try{
    for(const path of ['package.json','packages/nx-plugin/templates/next/package.json.template','packages/nx-plugin/src/workspace.ts','packages/ai-skills/src/index.ts','packages/ftg-cli/DESIGN-SYNC.md','.github/ISSUE_TEMPLATE/bug_report.yml']){
      await mkdir(dirname(join(copy,path)),{recursive:true});await cp(join(root,path),join(copy,path));
    }
    await cp(join(root,'packages/ai-skills/skills'),join(copy,'packages/ai-skills/skills'),{recursive:true});
    for(const directory of await readdir(join(root,'packages'))){
      await mkdir(join(copy,'packages',directory),{recursive:true});
      await cp(join(root,'packages',directory,'package.json'),join(copy,'packages',directory,'package.json'));
    }
    const moved=await setCohortVersion(copy,'9.8.7-rc.1');
    assert.equal(moved.from,declared);assert.equal(moved.to,'9.8.7-rc.1');
    assert.deepEqual(await cohortProblems(copy,'9.8.7-rc.1'),[]);
    assert.match(await readFile(join(copy,'packages/ftg-cli/DESIGN-SYNC.md'),'utf8'),/^CLI 9\.8\.7-rc\.1 implements/m);
    assert.match(await readFile(join(copy,'.github/ISSUE_TEMPLATE/bug_report.yml'),'utf8'),/ftg-cli 9\.8\.7-rc\.1"/);
    assert.ok((await cohortProblems(copy,declared)).length>0,'the old version is no longer the cohort');
    // A place the tool cannot find is an error: a template without a pin.
    await writeFile(join(copy,'packages/nx-plugin/templates/next/package.json.template'),'{}');
    await assert.rejects(setCohortVersion(copy,'9.8.8'),/COHORT_VERSION_NOT_FOUND:packages\/nx-plugin\/templates/);
    await assert.rejects(setCohortVersion(copy,'nine'),/USAGE/);
  }finally{await rm(copy,{recursive:true,force:true});}
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
