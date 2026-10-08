import { test } from 'node:test';import assert from 'node:assert/strict';import {applicationFiles} from '../src/index.js';
import * as generator from '../src/index.js';
import {mkdtemp,readFile,rm,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('workspace creation is a real deterministic command with dry-run and existing-destination refusal',async()=>{
  assert.equal(typeof generator.createWorkspace,'function','workspace initialization must not rely on a handwritten test setup');
  const temporary=await mkdtemp(join(tmpdir(),'mpfrontend-workspace-'));
  const directory=join(temporary,'consumer');
  try{
    const preview=await generator.createWorkspace({name:'consumer',directory,dryRun:true});
    assert.ok(preview.files.includes('nx.json'));
    await assert.rejects(lstat(directory),{code:'ENOENT'});
    const result=await generator.createWorkspace({name:'consumer',directory});
    assert.deepEqual(result.files,preview.files);
    const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
    assert.equal(manifest.packageManager,'pnpm@11.25.0');assert.equal(manifest.devDependencies.nx,'23.2.1');
    assert.equal(manifest.devDependencies['@mpfrontend/ftg-cli'],'0.1.0-dev.18');
    const workspace=JSON.parse(await readFile(join(directory,'.mpfrontend/workspace.json'),'utf8'));
    assert.equal(workspace.cliVersion,'0.1.0-dev.18');assert.equal(workspace.designSource,'none');
    assert.deepEqual(JSON.parse(await readFile(join(directory,'.mpfrontend/design-source.json'),'utf8')),{
      schemaVersion:1,generator:'MPFrontendDesignSource',cliVersion:'0.1.0-dev.18',source:'none',status:'disabled',binding:null,bindingHash:null,sourceIdentity:null,release:null
    });
    assert.ok((await readFile(join(directory,'README.md'),'utf8')).includes('eighteen finite workflows'));
    assert.ok((await readFile(join(directory,'pnpm-workspace.yaml'),'utf8')).includes('apps/*'));
    const before=await readFile(join(directory,'README.md'),'utf8');
    await assert.rejects(generator.createWorkspace({name:'consumer',directory}),/DESTINATION_EXISTS/);
    assert.equal(await readFile(join(directory,'README.md'),'utf8'),before);
    await assert.rejects(generator.createWorkspace({name:'../bad',directory:join(temporary,'bad')}),/INVALID_WORKSPACE_NAME/);
  }finally{await rm(temporary,{recursive:true,force:true});}
});
test('workspace design-source selection is explicit and pending modes do not invent bindings',async()=>{
  const files=generator.workspaceFiles('consumer','existing'),config=JSON.parse(files['.mpfrontend/design-source.json']!);
  assert.equal(config.source,'existing');assert.equal(config.status,'pending');assert.equal(config.binding,null);assert.equal(config.bindingHash,null);assert.equal(config.release,null);
  assert.ok(files['README.md']?.includes('consumer-owned DLS'));
  assert.throws(()=>generator.workspaceFiles('consumer','mpfrontend' as never),/INVALID_DESIGN_SOURCE/);
  assert.throws(()=>generator.workspaceFiles('consumer','invalid' as never),/INVALID_DESIGN_SOURCE/);
});
test('neutral generator emits independent application structure',async()=>{const files=await applicationFiles('sample');assert.ok(files['src/app/page.tsx']);assert.ok(files['src/features/catalog/ui/catalog.tsx']);assert.ok(!JSON.stringify(files).includes('__APP_NAME__'));});
test('unsafe app names fail before emission',async()=>{await assert.rejects(applicationFiles('../evil'),/INVALID/);});
test('generated application does not depend on a project in the original workspace',async()=>{
  const files=await applicationFiles('sample');
  const project=JSON.parse(files['project.json']!);
  assert.deepEqual(project.implicitDependencies ?? [],[]);
  assert.ok(files['next.config.mjs']?.includes("new URL('../..', import.meta.url)"));
  assert.equal(project.targets.build.options.cwd,'apps/sample');
  assert.equal(project.targets.build.options.command,'pnpm exec next build . --webpack');
});
test('Swagger assets are prepared outside webpack and served as UTF-8',async()=>{
  const files=await applicationFiles('sample');
  const project=JSON.parse(files['project.json']!) as {targets:Record<string,{dependsOn?:string[];options?:{command:string}}>};
  assert.ok(project.targets.build?.dependsOn?.includes('runtime-assets'));
  assert.ok(project.targets.build?.dependsOn?.includes('^build'),'dependent workspace libraries must build before a generated app');
  assert.equal(project.targets['runtime-assets']?.options?.command,'node apps/sample/prepare-runtime.mjs');
  assert.ok(files['prepare-runtime.mjs']?.includes("require.resolve('swagger-ui-dist/' + file)"));
  const route=files['src/app/api/docs/assets/[file]/route.ts']!;
  assert.ok(!route.includes('createRequire'));
  assert.ok(route.includes('apps/sample/runtime-assets/swagger'));
  assert.ok(route.includes('application/javascript; charset=utf-8'));
  assert.ok(files['src/app/api/docs/route.ts']?.includes('<meta charset="utf-8">'));
  assert.equal(JSON.parse(files['package.json']!).dependencies['swagger-ui-dist'],'5.29.5');
});
