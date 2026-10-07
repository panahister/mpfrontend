import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createWorkspace} from '@mpfrontend/nx-plugin';
import {designSourceCommand} from '../src/design-source.js';

const cliVersion='0.1.0-dev.18';
const binding=(fileKey='consumer-file',nodeId='1:2')=>({schemaVersion:1,id:'consumer-dls',source:{fileKey,nodeId},brandId:'consumer',modeAttribute:'data-mode',
  stateDirectory:'.mpfrontend/design/consumer-dls',outputDirectory:'themes/consumer/generated',tokens:[],components:[],ignoredTokens:[],ignoredComponents:[]});
async function workspace(source:'none'|'existing'='none'){
  const temporary=await mkdtemp(join(tmpdir(),'mpfrontend-design-source-')),root=join(temporary,'consumer');
  await createWorkspace({name:'consumer',directory:root,designSource:source});return {temporary,root};
}
async function put(root:string,path:string,value:unknown|string){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),typeof value==='string'?value:JSON.stringify(value));}

test('none is usable, reports disabled and can attach an existing private design later',async()=>{
  const {temporary,root}=await workspace();
  try{
    assert.deepEqual(await designSourceCommand({command:'status',directory:root,cliVersion}),{ok:true,command:'status',source:'none',status:'disabled',binding:null,bindingHash:null,releaseVersion:null});
    await put(root,'design.binding.json',binding());
    const before=await readFile(join(root,'.mpfrontend/design-source.json'),'utf8');
    const preview=await designSourceCommand({command:'attach',directory:root,source:'existing',bindingPath:'design.binding.json',dryRun:true,cliVersion});
    assert.deepEqual(preview.changed,['.mpfrontend/design-source.json']);assert.equal(await readFile(join(root,'.mpfrontend/design-source.json'),'utf8'),before);
    const attached=await designSourceCommand({command:'attach',directory:root,source:'existing',bindingPath:'design.binding.json',cliVersion});
    assert.equal(attached.status,'attached');assert.equal(attached.releaseVersion,null);
    assert.equal((await designSourceCommand({command:'status',directory:root,cliVersion})).source,'existing');
    assert.deepEqual((await designSourceCommand({command:'attach',directory:root,source:'existing',bindingPath:'design.binding.json',cliVersion})).changed,[]);
    const config=JSON.parse(await readFile(join(root,'.mpfrontend/design-source.json'),'utf8'));assert.equal(config.sourceIdentity,null);assert.match(config.bindingHash,/^[a-f0-9]{64}$/);
    await put(root,'design.binding.json',{...binding(),modeAttribute:'data-theme'});
    await assert.rejects(designSourceCommand({command:'status',directory:root,cliVersion}),/DESIGN_BINDING_DRIFT/);
  }finally{await rm(temporary,{recursive:true,force:true});}
});

test('pending source is enforced and attached source is immutable',async()=>{
  const {temporary,root}=await workspace('existing');
  try{
    await put(root,'design.binding.json',binding());
    await assert.rejects(designSourceCommand({command:'attach',directory:root,source:'mpfrontend' as never,bindingPath:'design.binding.json',cliVersion}),/ATTACHABLE_DESIGN_SOURCE_REQUIRED/);
    await designSourceCommand({command:'attach',directory:root,source:'existing',bindingPath:'design.binding.json',cliVersion});
    await put(root,'other.binding.json',binding('other-file'));
    await assert.rejects(designSourceCommand({command:'attach',directory:root,source:'existing',bindingPath:'other.binding.json',cliVersion}),/DESIGN_SOURCE_ALREADY_ATTACHED/);
  }finally{await rm(temporary,{recursive:true,force:true});}
});

test('legacy public-template configuration is rejected by the MVP contract',async()=>{
  const {temporary,root}=await workspace();
  try{
    const path=join(root,'.mpfrontend/design-source.json'),config=JSON.parse(await readFile(path,'utf8'));
    await writeFile(path,JSON.stringify({...config,source:'mpfrontend'}));
    await assert.rejects(designSourceCommand({command:'status',directory:root,cliVersion}),/INVALID_DESIGN_SOURCE_CONFIG/);
  }finally{await rm(temporary,{recursive:true,force:true});}
});

test('consumer binding refuses symlinks and an active writer lock',async()=>{
  const unsafe=await workspace('existing');
  try{
    await put(unsafe.root,'real.binding.json',binding());await symlink(join(unsafe.root,'real.binding.json'),join(unsafe.root,'design.binding.json'));
    await assert.rejects(designSourceCommand({command:'attach',directory:unsafe.root,source:'existing',bindingPath:'design.binding.json',cliVersion}),/DESIGN_SOURCE_PATH_SYMLINK/);
    await rm(join(unsafe.root,'design.binding.json'));await put(unsafe.root,'design.binding.json',binding());await put(unsafe.root,'.mpfrontend/design-source.lock','held');
    await assert.rejects(designSourceCommand({command:'attach',directory:unsafe.root,source:'existing',bindingPath:'design.binding.json',cliVersion}),/DESIGN_SOURCE_BUSY/);
  }finally{await rm(unsafe.temporary,{recursive:true,force:true});}
});
