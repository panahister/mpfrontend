import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {COHORT} from '../src/workspace.js';

// A generated workspace or app installs the framework packages at the versions written here, so each one must be
// the version this repository packs. The packed consumer check forces its archives through overrides and cannot
// see a stale pin.
const packedVersion=async(name:string)=>
  (JSON.parse(await readFile(new URL(`../../${name}/package.json`,import.meta.url),'utf8')) as {version:string}).version;

test('the app template pins each framework package at the version this repository packs',async()=>{
  const template=JSON.parse(await readFile(new URL('../templates/next/package.json.template',import.meta.url),'utf8')) as {
    dependencies:Record<string,string>;
  };
  const pins=Object.entries(template.dependencies).filter(([name])=>name.startsWith('@mpfrontend/'));
  assert.ok(pins.length>0,'the app template names framework packages');
  for(const [name,pinned] of pins)assert.equal(pinned,await packedVersion(name.slice('@mpfrontend/'.length)),`${name} in the app template`);
});

test('the workspace cohort names the versions this repository packs',async()=>{
  assert.equal(COHORT.cli,await packedVersion('ftg-cli'));
  assert.equal(COHORT.nxPlugin,await packedVersion('nx-plugin'));
  assert.equal(COHORT.workspaceConfig,await packedVersion('workspace-config'));
});

// One cohort version: every package carries the version that the workspace declares, and the AI procedures name it.
test('every package carries the one cohort version that the workspace declares',async()=>{
  const declared=(JSON.parse(await readFile(new URL('../../../package.json',import.meta.url),'utf8')) as {version:string}).version;
  for(const name of ['access-core','access-react','ai-skills','app-layout','data-react','ftg-cli','ftg-core','i18n','nx-plugin',
    'presentation-server','primitives','realtime-core','security-bff','tokens','ui','workspace-config'])
    assert.equal(await packedVersion(name),declared,name);
  const skills=await readFile(new URL('../../ai-skills/src/index.ts',import.meta.url),'utf8');
  assert.match(skills,new RegExp(`SKILLS_VERSION='${declared}',SKILLS_CLI_VERSION='${declared}'`));
});
