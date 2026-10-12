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
  // The check of a pull request runs it too: the build that CI runs is the build that compares with the published API.
  const ci=await readFile(join(root,'.github/workflows/ci.yml'),'utf8');
  assert.match(ci,/nx run-many -t [^\n]*\bapi-check\b[^\n]*--skip-nx-cache/);
  assert.match(await readFile(join(root,'.github/workflows/release.yml'),'utf8'),/pnpm check --skip-nx-cache/);
});

test('README "Versioning" states the compatibility policy that the checks enforce',async()=>{
  const readme=await readFile(join(root,'README.md'),'utf8'),section=readme.slice(readme.indexOf('\n## Versioning\n'),readme.indexOf('\n## Verify the repository'));
  assert.ok(section.length>500,'the section exists');
  for(const [claim,pattern] of [
    ['what is public API',/public API is the exports of each package's entry points/],
    ['what is not public API',/not public, and may change in any version/],
    ['a breaking change waits for the next major version',/breaking change[^.]*waits for the next major version/],
    ['an export is deprecated for at least one minor version',/deprecated for at least one minor version before it goes/],
    ['the previous major gets fixes for 12 months',/previous major version receives security fixes and fixes of defects that lose data\s+or break security for 12 months/],
    ['never past the end of support of its Node version',/never past the end of support of the Node\s+version it targets/],
    ['every build compares with the published API',/Every build compares the built declarations/],
  ])assert.match(section,pattern,claim);
});

/** The places where an `@mpfrontend/<package>/internal` import appears in a text. */
const internalImports=text=>text.match(/@mpfrontend\/[a-z0-9-]+\/internal\b/g)??[];
async function sourceFiles(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(['node_modules','dist','.next','.nx'].includes(entry.name))continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())files.push(...await sourceFiles(path));else files.push(path);
  }
  return files;
}

test('no template and no generator writes an import of an internal entry, which is outside the compatibility guarantee',async()=>{
  // The control: what the scan must find.
  assert.deepEqual(internalImports("import {x} from '@mpfrontend/ui/internal';\nimport {y} from '@mpfrontend/ui';"),['@mpfrontend/ui/internal']);
  assert.deepEqual(internalImports('import {y} from "@mpfrontend/internals-are-not-a-package";'),[]);
  // The templates and the code that writes code: nx-plugin, and ftg-core's generator, name no internal entry at all.
  for(const directory of ['packages/nx-plugin/templates','packages/nx-plugin/src','packages/ftg-core/src'])
    for(const path of await sourceFiles(join(root,directory)))
      assert.deepEqual(internalImports(await readFile(path,'utf8')),[],path.slice(root.length));
  // The CLI imports internal entries in its own code, as real import statements, and writes none into what it generates.
  for(const path of (await sourceFiles(join(root,'packages/ftg-cli/src'))).filter(file=>/\.tsx?$/.test(file))){
    const text=await readFile(path,'utf8'),imports=text.split('\n').filter(line=>/^import .* from '@mpfrontend\/[a-z0-9-]+\/internal';?$/.test(line));
    assert.equal(internalImports(text).length,imports.length,'only import statements of the CLI itself name an internal entry: '+path.slice(root.length));
  }
});

test('an internal entry is outside the report: it holds none of its exports, and the compatibility guarantee is said to leave it out',async()=>{
  const bytes=await archive('@mpfrontend/y','1.0.0','export declare const a: string;\n');
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-internal-test-'));
  try{
    await mkdir(join(directory,'dist'),{recursive:true});
    await writeFile(join(directory,'dist/index.d.ts'),'export declare const a: string;\n');
    await writeFile(join(directory,'dist/internal.d.ts'),'export declare const b: string;\n');
    const manifest={name:'@mpfrontend/y',version:'1.0.0',exports:{'.':{types:'./dist/index.d.ts'},'./internal':{types:'./dist/internal.d.ts'}}};
    const report=apiReport(directory,manifest);
    assert.deepEqual(Object.keys(report.entries),['.']);assert.deepEqual(Object.keys(report.entries['.']),['a']);
  }finally{await rm(directory,{recursive:true,force:true});}
  assert.ok(bytes.length>0);
  const readme=await readFile(join(root,'README.md'),'utf8');
  assert.match(readme,/entry point named `internal`[^.]*outside\s+the\s+compatibility\s+guarantee/);
});
