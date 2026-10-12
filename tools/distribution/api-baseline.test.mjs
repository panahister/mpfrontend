import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {baselineReport,baselineProblems,apiReport} from './api-report.mjs';
import {integrityOf} from './release.mjs';

const exec=promisify(execFile),root=fileURLToPath(new URL('../../',import.meta.url));
/** The bytes of a package archive that exports `declarations`, as npm packs one (everything below package/). */
async function archive(name,version,declarations){
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-baseline-test-'));
  try{
    await mkdir(join(directory,'package/dist'),{recursive:true});
    await writeFile(join(directory,'package/package.json'),JSON.stringify({name,version,exports:{'.':{types:'./dist/index.d.ts',import:'./dist/index.js'}}}));
    await writeFile(join(directory,'package/dist/index.d.ts'),declarations);
    await exec('tar',['-czf',join(directory,'a.tgz'),'-C',directory,'package']);
    return await readFile(join(directory,'a.tgz'));
  }finally{await rm(directory,{recursive:true,force:true});}
}
const registry=(files,status=200)=>async url=>{
  const bytes=files[new URL(url).pathname];
  return bytes===undefined?{status:404,arrayBuffer:async()=>new ArrayBuffer(0)}:{status,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
};
const current=(version,declarations)=>({schemaVersion:1,package:'@mpfrontend/x',version,entries:{'.':Object.fromEntries(declarations.map(([key,text])=>[key,text]))}});

test('the baseline is the published archive: its bytes must be the recorded ones, and its API is what a build is compared with',async()=>{
  const bytes=await archive('@mpfrontend/x','1.0.0','export declare const a: string;\nexport declare function b(): void;\n');
  const files={'/@mpfrontend/x/-/x-1.0.0.tgz':bytes},integrity=integrityOf(bytes);
  const base=await baselineReport('@mpfrontend/x','1.0.0',integrity,{fetchImpl:registry(files)});
  assert.equal(base.package,'@mpfrontend/x');assert.equal(base.version,'1.0.0');
  assert.deepEqual(Object.keys(base.entries['.']).sort(),['a','b']);
  const baseline={version:'1.0.0',packages:{'@mpfrontend/x':{integrity}}};
  // The same API, an added export and a removed one, each against a version that the policy does or does not allow.
  const same=current('1.0.1',[...Object.entries(base.entries['.'])]);
  assert.deepEqual(await baselineProblems(baseline,[same],{fetchImpl:registry(files)}),[]);
  const removed=current('1.0.1',[['a',base.entries['.'].a]]);
  assert.match((await baselineProblems(baseline,[removed],{fetchImpl:registry(files)})).join(),/API_BREAK_NEEDS_MAJOR/);
  assert.deepEqual(await baselineProblems(baseline,[{...removed,version:'2.0.0'}],{fetchImpl:registry(files)}),[]);
  const added=current('1.0.0',[...Object.entries(base.entries['.']),['c','export declare const c: number;']]);
  assert.match((await baselineProblems(baseline,[added],{fetchImpl:registry(files)})).join(),/API_CHANGED_WITHOUT_NEW_VERSION/);
});

test('a baseline that cannot be had is a failure, never a skip: other bytes, no archive, no answer, a package the file does not name',async()=>{
  const bytes=await archive('@mpfrontend/x','1.0.0','export declare const a: string;\n');
  const files={'/@mpfrontend/x/-/x-1.0.0.tgz':bytes},integrity=integrityOf(bytes);
  const report=current('1.0.1',[['a','export declare const a: string;']]);
  const problems=baseline=>baselineProblems(baseline,[report],{fetchImpl:registry(files)});
  assert.match((await problems({version:'1.0.0',packages:{'@mpfrontend/x':{integrity:'sha512-other'}}})).join(),/API_BASELINE_UNAVAILABLE:@mpfrontend\/x@1.0.0: BASELINE_INTEGRITY_MISMATCH/);
  assert.match((await problems({version:'1.0.1',packages:{'@mpfrontend/x':{integrity}}})).join(),/BASELINE_ARCHIVE_ANSWER:404/);
  assert.deepEqual(await problems({version:'1.0.0',packages:{}}),['API_BASELINE_MISSING:@mpfrontend/x']);
  const offline=await baselineProblems({version:'1.0.0',packages:{'@mpfrontend/x':{integrity}}},[report],{fetchImpl:async()=>{throw new Error('offline');}});
  assert.match(offline.join(),/API_BASELINE_UNAVAILABLE:.*offline/);
});

test('the baseline file names every package of the cohort at one published version, and the check runs in every build',async()=>{
  const baseline=JSON.parse(await readFile(join(root,'tools/distribution/api-baseline.json'),'utf8'));
  assert.match(baseline.version,/^\d+\.\d+\.\d+$/);assert.match(baseline.commit,/^[0-9a-f]{40}$/);
  const names=(await Promise.all((await readdir(join(root,'packages'))).map(async directory=>JSON.parse(await readFile(join(root,'packages',directory,'package.json'),'utf8')).name))).sort();
  assert.deepEqual(Object.keys(baseline.packages).sort(),names);
  for(const entry of Object.values(baseline.packages))assert.match(entry.integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  const project=JSON.parse(await readFile(join(root,'tools/distribution/project.json'),'utf8'));
  assert.equal(project.targets['api-check'].cache,false,'a cached pass would be a build that did not compare');
  assert.match(project.targets['api-check'].options.command,/api-report\.mjs check/);
  assert.match(JSON.parse(await readFile(join(root,'package.json'),'utf8')).scripts.check,/\bapi-check\b/);
});
