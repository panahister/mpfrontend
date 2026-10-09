import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {delimiter,join} from 'node:path';
import {findExecutable,independentToolchain} from './toolchain.mjs';

// A toolchain whose Node and pnpm live in a node_modules/.bin directory, as a project-local install has them.
async function localToolchain(root){
  const bin=join(root,'project/node_modules/.bin');await mkdir(bin,{recursive:true});
  const pnpm=findExecutable('pnpm',process.env.PATH);
  assert.ok(pnpm,'the test needs the pnpm that runs it');
  for(const [name,target] of [['node',process.execPath],['pnpm',pnpm]]){
    await writeFile(join(bin,name),'#!/bin/sh\nexec "'+target+'" "$@"\n');await chmod(join(bin,name),0o755);
  }
  return [bin,'/usr/bin','/bin'].join(delimiter);
}

test('a nested pnpm runs with the pinned Node and pnpm even when they live in node_modules/.bin',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mpfrontend-toolchain-'));
  try{
    const path=await localToolchain(root);
    // Removing every node_modules/.bin entry alone, as before, loses pnpm.
    const filtered=path.split(delimiter).filter(entry=>!entry.includes('node_modules/.bin')).join(delimiter);
    assert.equal(spawnSync('pnpm',['--version'],{env:{PATH:filtered}}).error?.code,'ENOENT');
    const toolchain=await independentToolchain(join(root,'toolchain'),{path});
    assert.ok(!toolchain.path.split(delimiter).some(entry=>entry.includes('node_modules/.bin')),'no node_modules/.bin entry remains');
    const version=spawnSync('pnpm',['--version'],{env:{PATH:toolchain.path},encoding:'utf8'});
    assert.equal(version.status,0,version.stderr);
    assert.match(version.stdout.trim(),/^\d+\.\d+\.\d+$/);
    const node=spawnSync('node',['-p','process.version'],{env:{PATH:toolchain.path},encoding:'utf8'});
    assert.equal(node.stdout.trim(),process.version,'the pinned Node');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('without a pnpm on the PATH the toolchain is refused',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mpfrontend-toolchain-'));
  try{await assert.rejects(independentToolchain(join(root,'toolchain'),{path:root}),/PNPM_NOT_FOUND/);}
  finally{await rm(root,{recursive:true,force:true});}
});
