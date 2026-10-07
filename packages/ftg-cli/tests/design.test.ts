import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm,mkdir,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {designCommand} from '../src/design.js';

const snapshot={schemaVersion:1,source:{fileKey:'fixture',nodeId:'1:2',revision:null,
  capturedAt:'2026-10-07T07:00:00.000Z',extractorVersion:'fixture-v1'},modes:['light','dark'],
  tokens:[{id:'color:surface',name:'Surface',type:'color',values:{light:'#ffffff',dark:'#101010'}},
    {id:'space:control',name:'Control spacing',type:'dimension',values:{light:{value:8,unit:'px'},dark:{value:8,unit:'px'}}}],
  components:[],assets:[]};
const binding={schemaVersion:1,id:'fixture',source:{fileKey:'fixture',nodeId:'1:2'},
  brandId:'fixture-brand',modeAttribute:'data-theme',
  stateDirectory:'.mpfrontend/design/fixture',outputDirectory:'themes/fixture/generated',
  tokens:[{sourceId:'color:surface',cssName:'--mp-surface'},{sourceId:'space:control',cssName:'--mp-control-gap'}],
  components:[],ignoredTokens:[],ignoredComponents:[]};
function cli(args:string[],expectedCode=0){
  const require=createRequire(import.meta.url);
  const env={...process.env};delete env.FORCE_COLOR;
  const result=spawnSync(process.execPath,['--import',require.resolve('tsx'),
    fileURLToPath(new URL('../src/cli.ts',import.meta.url)),'design',...args,'--json'],{encoding:'utf8',env});
  assert.equal(result.status,expectedCode,result.stdout+result.stderr);
  return JSON.parse(expectedCode?result.stderr:result.stdout);
}
test('actual design CLI imports an immutable candidate without advancing a baseline or writing on dry-run',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mpfrontend-design-cli-'));
  try{
    const config=join(root,'design.binding.json'),exportPath=join(root,'snapshot.json');
    await writeFile(config,JSON.stringify(binding));await writeFile(exportPath,JSON.stringify(snapshot));
    const before=await readdir(root);
    const dry=cli(['import','--binding',config,'--snapshot',exportPath,'--dry-run']);
    assert.equal(dry.ok,true);assert.equal(dry.dryRun,true);assert.match(dry.candidateHash,/^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(root),before);
    const imported=cli(['import','--binding',config,'--snapshot',exportPath]);
    assert.equal(imported.candidateHash,dry.candidateHash);
    const stored=join(root,binding.stateDirectory,'snapshots',imported.candidateHash+'.json');
    const bytes=await readFile(stored,'utf8');
    assert.deepEqual(cli(['import','--binding',config,'--snapshot',exportPath]).changed,[]);
    assert.equal(await readFile(stored,'utf8'),bytes);
    await assert.rejects(readFile(join(root,binding.stateDirectory,'baseline.json')),{code:'ENOENT'});
    const validated=cli(['validate','--binding',config,'--candidate',imported.candidateHash]);
    assert.equal(validated.ok,true);assert.equal(validated.sourceRevision,null);
  }finally{await rm(root,{recursive:true,force:true});}
});

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'mpfrontend-design-state-')),config=join(root,'design.binding.json'),exportPath=join(root,'snapshot.json');
  await writeFile(config,JSON.stringify(binding));await writeFile(exportPath,JSON.stringify(snapshot));
  const imported=await designCommand({command:'import',bindingPath:config,snapshotPath:exportPath});
  const candidate=String(imported.candidateHash);
  return {root,config,exportPath,candidate,state:join(root,binding.stateDirectory),async plan(){
    return await designCommand({command:'plan',bindingPath:config,candidate});
  }};
}
// Synthetic unit attestation only: not a report that actual reference visual/CI checks passed.
async function evidence(root:string,planned:Awaited<ReturnType<typeof designCommand>>,{failed=false,tasks=true}={}){
  const plan=planned.plan!;await mkdir(join(root,'evidence'),{recursive:true});
  const report=join(root,'evidence/synthetic-check.txt'),reportBytes='Synthetic lifecycle fixture; no real UI acceptance.\n';await writeFile(report,reportBytes);
  const files=async(paths:string[])=>{const result=[];for(const path of paths){await mkdir(join(root,dirname(path)),{recursive:true});await writeFile(join(root,path),'Authored fixture '+path);result.push({path,sha256:hash(await readFile(join(root,path),'utf8'))});}return result;};
  const value={schemaVersion:1,planId:plan.planId,candidateHash:plan.candidateHash,bindingHash:plan.bindingHash,cliVersion:plan.cliVersion,
    review:{approved:true,reviewer:'synthetic-unit-fixture'},checks:plan.checks.map(name=>({name,passed:!failed,command:'synthetic fixture only',artifact:{path:'evidence/synthetic-check.txt',sha256:hash(reportBytes)}})),
    tasks:tasks?await Promise.all(plan.tasks.map(async task=>({id:task.id,status:'implemented',files:await files(task.requiredFiles.length?task.requiredFiles:['src/migration.fixture.ts'])}))):[]};
  const path=join(root,'evidence/acceptance.json');await writeFile(path,JSON.stringify(value));return path;
}

test('apply requires an exact plan and acceptance requires reviewed passing evidence; check detects evidence drift',async()=>{
  const f=await fixture();
  try{
    const planned=await f.plan(),planPath=String(planned.planPath);
    assert.deepEqual((await designCommand({command:'plan',bindingPath:f.config,candidate:f.candidate})).changed,[]);
    await assert.rejects(designCommand({command:'check',bindingPath:f.config}),/DESIGN_BASELINE_NOT_ACCEPTED/);
    const applied=await designCommand({command:'apply',planPath,dryRun:true});assert.equal(applied.dryRun,true);
    await assert.rejects(readFile(join(f.root,binding.outputDirectory,'tokens.gen.css')),{code:'ENOENT'});
    await designCommand({command:'apply',planPath});
    assert.deepEqual((await designCommand({command:'apply',planPath})).changed,[]);
    assert.match(await readFile(join(f.root,binding.outputDirectory,'tokens.gen.css'),'utf8'),/--mp-surface: #101010/);
    assert.match(await readFile(join(f.root,binding.outputDirectory,'tokens.gen.css'),'utf8'),/:root\[data-brand="fixture-brand"\]\[data-theme="dark"\]/);
    assert.match(await readFile(join(f.root,binding.outputDirectory,'tokens.gen.css'),'utf8'),/@media \(prefers-color-scheme:dark\)/);
    assert.match(await readFile(join(f.root,binding.outputDirectory,'tokens.gen.css'),'utf8'),/data-theme="system"/);
    const before=await readdir(f.state);const bad=await evidence(f.root,planned,{failed:true});
    await assert.rejects(designCommand({command:'accept',planPath,evidencePath:bad}),/DESIGN_CHECK_NOT_PASSED/);
    assert.deepEqual(await readdir(f.state),before);
    const good=await evidence(f.root,planned);
    await designCommand({command:'accept',planPath,evidencePath:good,dryRun:true});
    await assert.rejects(readFile(join(f.state,'baseline.json')),{code:'ENOENT'});
    await designCommand({command:'accept',planPath,evidencePath:good});
    assert.deepEqual((await designCommand({command:'accept',planPath,evidencePath:good})).changed,[]);
    assert.equal((await designCommand({command:'check',bindingPath:f.config})).ok,true);
    await writeFile(join(f.root,'evidence/synthetic-check.txt'),'changed after review');
    await assert.rejects(designCommand({command:'check',bindingPath:f.config}),/DESIGN_EVIDENCE_ARTIFACT_DRIFT/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('changed behavior and removed components require authored evidence; binary artifacts are hashed as bytes',async()=>{
  const f=await fixture();
  try{
    const component={id:'button:1',name:'Button',variants:{tone:['primary','ghost']},properties:{disabled:'boolean'},behavior:{status:'known',description:'Disabled prevents submit'},assets:[]};
    const configured={...binding,components:[{sourceId:component.id,adapter:'src/button.tsx',tests:['tests/button.test.ts']}]};
    await writeFile(f.config,JSON.stringify(configured));await writeFile(f.exportPath,JSON.stringify({...snapshot,components:[component]}));
    let imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    let planned=await designCommand({command:'plan',bindingPath:f.config,candidate:String(imported.candidateHash)});
    await designCommand({command:'apply',planPath:String(planned.planPath)});
    await designCommand({command:'accept',planPath:String(planned.planPath),evidencePath:await evidence(f.root,planned)});
    const authored=await readFile(join(f.root,'src/button.tsx'),'utf8');
    const changed={...component,behavior:{status:'known',description:'Disabled prevents submit and keyboard activation'}};
    await writeFile(f.exportPath,JSON.stringify({...snapshot,components:[changed]}));
    imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    planned=await designCommand({command:'plan',bindingPath:f.config,candidate:String(imported.candidateHash)});
    assert.ok(planned.plan!.changes.some(change=>change.id===component.id&&change.areas.includes('behavior')&&change.severity==='breaking'));
    await designCommand({command:'apply',planPath:String(planned.planPath)});assert.equal(await readFile(join(f.root,'src/button.tsx'),'utf8'),authored);
    const evidencePath=await evidence(f.root,planned),report=JSON.parse(await readFile(evidencePath,'utf8'));
    const binary=Buffer.from([0,255,128,44,13,10]);await writeFile(join(f.root,'evidence/synthetic-image.bin'),binary);
    report.checks[0].artifact={path:'evidence/synthetic-image.bin',sha256:createHash('sha256').update(binary).digest('hex')};await writeFile(evidencePath,JSON.stringify(report));
    await designCommand({command:'accept',planPath:String(planned.planPath),evidencePath});assert.equal((await designCommand({command:'check',bindingPath:f.config})).ok,true);
    await writeFile(f.exportPath,JSON.stringify(snapshot));
    imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    planned=await designCommand({command:'plan',bindingPath:f.config,candidate:String(imported.candidateHash)});
    assert.ok(planned.plan!.changes.some(change=>change.id===component.id&&change.action==='removed'&&change.severity==='breaking'));
    await designCommand({command:'apply',planPath:String(planned.planPath)});assert.equal(await readFile(join(f.root,'src/button.tsx'),'utf8'),authored);
    await assert.rejects(designCommand({command:'accept',planPath:String(planned.planPath),evidencePath:await evidence(f.root,planned,{tasks:false})}),/DESIGN_TASK_NOT_IMPLEMENTED/);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('stable IDs produce semantic renames and component behavior tasks, never overwrite authored adapters',async()=>{
  const f=await fixture();
  try{
    const first=await f.plan();await designCommand({command:'apply',planPath:String(first.planPath)});
    await designCommand({command:'accept',planPath:String(first.planPath),evidencePath:await evidence(f.root,first)});
    const next={...structuredClone(snapshot),components:[{id:'button:1',name:'Button',variants:{tone:['primary','ghost']},properties:{disabled:'boolean'},behavior:{status:'known',description:'Disabled prevents submit'},assets:[]}]};
    next.tokens[0]!.name='Canvas';
    await writeFile(f.config,JSON.stringify({...binding,components:[{sourceId:'button:1',adapter:'src/button.tsx',tests:['tests/button.test.ts']}]}));
    await writeFile(f.exportPath,JSON.stringify(next));
    const imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    const candidate=String(imported.candidateHash),diff=await designCommand({command:'diff',bindingPath:f.config,candidate});
    assert.ok(diff.changes!.some(change=>change.kind==='token'&&change.id==='color:surface'&&change.action==='changed'&&change.areas.includes('name')));
    const planned=await designCommand({command:'plan',bindingPath:f.config,candidate}),planPath=String(planned.planPath);
    assert.equal(planned.plan!.tasks.length,2);await mkdir(join(f.root,'src'));await writeFile(join(f.root,'src/button.tsx'),'Product extension must survive');
    await designCommand({command:'apply',planPath});assert.equal(await readFile(join(f.root,'src/button.tsx'),'utf8'),'Product extension must survive');
    const incomplete=await evidence(f.root,planned,{tasks:false});
    await assert.rejects(designCommand({command:'accept',planPath,evidencePath:incomplete}),/DESIGN_TASK_NOT_IMPLEMENTED/);
    const complete=await evidence(f.root,planned);await designCommand({command:'accept',planPath,evidencePath:complete});
    assert.equal((await designCommand({command:'check',bindingPath:f.config})).ok,true);
    assert.deepEqual((await designCommand({command:'diff',bindingPath:f.config,candidate})).changes,[]);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('aliases are resolved in both modes; missing modes, cycles, mismatched types and unsafe values are rejected',async()=>{
  const f=await fixture();
  try{
    const alias={id:'color:alias',name:'Alias',type:'color',values:{light:{alias:'color:surface'},dark:{alias:'color:surface'}}};
    await writeFile(f.config,JSON.stringify({...binding,tokens:[...binding.tokens,{sourceId:alias.id,cssName:'--mp-alias'}]}));
    await writeFile(f.exportPath,JSON.stringify({...snapshot,tokens:[...snapshot.tokens,alias]}));
    const imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    const planned=await designCommand({command:'plan',bindingPath:f.config,candidate:String(imported.candidateHash)});
    await designCommand({command:'apply',planPath:String(planned.planPath)});
    assert.match(await readFile(join(f.root,binding.outputDirectory,'tokens.gen.css'),'utf8'),/--mp-alias: #ffffff/);
    for(const [next,diagnostic]of [
      [{...snapshot,modes:['light']},/DESIGN_LIGHT_DARK_REQUIRED/],
      [{...snapshot,tokens:[{...alias,values:{light:{alias:alias.id},dark:{alias:alias.id}}}]},/DESIGN_ALIAS_CYCLE/],
      [{...snapshot,tokens:[...snapshot.tokens,{...alias,values:{light:{alias:'space:control'},dark:{alias:'space:control'}}}]},/INCOMPATIBLE_DESIGN_ALIAS/],
      [{...snapshot,tokens:[{...snapshot.tokens[0],values:{light:'red; } body { color:red',dark:'#000000'}}]},/INVALID_DESIGN_COLOR/]
    ] as const){await writeFile(f.exportPath,JSON.stringify(next));await assert.rejects(designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath}),diagnostic);}
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('unmapped tokens and unknown behavior remain unresolved and cannot be applied or accepted',async()=>{
  const f=await fixture();
  try{
    await writeFile(f.config,JSON.stringify({...binding,tokens:[],components:[{sourceId:'button:1',adapter:'src/button.tsx',tests:['tests/button.test.ts']}]}));
    await writeFile(f.exportPath,JSON.stringify({...snapshot,components:[{id:'button:1',name:'Button',variants:{},properties:{},behavior:{status:'unknown',description:'No interaction evidence supplied'},assets:[]}]}));
    const imported=await designCommand({command:'import',bindingPath:f.config,snapshotPath:f.exportPath});
    assert.ok(imported.diagnostics!.includes('UNKNOWN_COMPONENT_BEHAVIOR:button:1'));
    const candidate=String(imported.candidateHash);
    await assert.rejects(designCommand({command:'validate',bindingPath:f.config,candidate}),/INVALID_DESIGN_MAPPING/);
    const planned=await designCommand({command:'plan',bindingPath:f.config,candidate});
    await assert.rejects(designCommand({command:'apply',planPath:String(planned.planPath)}),/UNRESOLVED_DESIGN_PLAN/);
    await assert.rejects(readFile(join(f.state,'baseline.json')),{code:'ENOENT'});
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('stale CLI/binding/candidate/output plans and unowned collisions fail without overwriting either owner',async()=>{
  const f=await fixture();
  try{
    const planned=await f.plan(),planPath=String(planned.planPath),before=await readFile(planPath,'utf8');
    const altered=JSON.parse(before);altered.cliVersion='old';const body={...altered};delete body.planId;altered.planId=hash(JSON.stringify(body));
    // A tampered plan is not repaired or accepted merely because it claims an older compatible version.
    await writeFile(planPath,JSON.stringify(altered));await assert.rejects(designCommand({command:'apply',planPath}),/DESIGN_PLAN_DRIFT|DESIGN_PLAN_OUTSIDE/);
    await writeFile(planPath,before);await writeFile(f.config,JSON.stringify({...binding,tokens:binding.tokens.map(t=>({...t,cssName:t.cssName+'-changed'}))}));
    await assert.rejects(designCommand({command:'apply',planPath}),/STALE_DESIGN_PLAN/);
    await writeFile(f.config,JSON.stringify(binding));
    const candidatePath=join(f.state,'snapshots',f.candidate+'.json'),candidateBytes=await readFile(candidatePath,'utf8');
    await writeFile(candidatePath,candidateBytes.replace('#ffffff','#eeeeee'));await assert.rejects(designCommand({command:'apply',planPath}),/DESIGN_CANDIDATE_DRIFT/);
    await writeFile(candidatePath,candidateBytes);await mkdir(join(f.root,binding.outputDirectory),{recursive:true});
    const cssPath=join(f.root,binding.outputDirectory,'tokens.gen.css');await writeFile(cssPath,'Authored theme');
    await assert.rejects(designCommand({command:'apply',planPath}),/AUTHORED_DESIGN_OUTPUT_COLLISION/);assert.equal(await readFile(cssPath,'utf8'),'Authored theme');
    await rm(cssPath);await designCommand({command:'apply',planPath});await writeFile(cssPath,'Changed owned output');
    await assert.rejects(designCommand({command:'apply',planPath}),/DESIGN_OUTPUT_DRIFT/);assert.equal(await readFile(cssPath,'utf8'),'Changed owned output');
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('path traversal, symlink parents and a live/interrupted writer are refused even on dry-run',async()=>{
  const f=await fixture();
  try{
    await writeFile(f.config,JSON.stringify({...binding,outputDirectory:'themes/../../outside/generated'}));
    await assert.rejects(designCommand({command:'plan',bindingPath:f.config,candidate:f.candidate}),/UNSAFE_DESIGN_PATH/);
    await writeFile(f.config,JSON.stringify(binding));await mkdir(join(f.root,'outside'));
    await symlink(join(f.root,'outside'),join(f.root,'themes'),'dir');
    await assert.rejects(designCommand({command:'plan',bindingPath:f.config,candidate:f.candidate}),/DESIGN_PATH_SYMLINK/);assert.deepEqual(await readdir(join(f.root,'outside')),[]);
    await rm(join(f.root,'themes'));const marker=join(f.state,'.design-write.lock');await writeFile(marker,'another writer');
    for(const command of ['import','validate','diff','plan','check'])await assert.rejects(designCommand({command,bindingPath:f.config,snapshotPath:f.exportPath,candidate:f.candidate,dryRun:true}),/DESIGN_SYNC_BUSY/);
    assert.equal(await readFile(marker,'utf8'),'another writer');
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('isolated acceptance guard removals fail actual rejection assertions, not module loading',async()=>{
  const source=await readFile(new URL('../src/design.ts',import.meta.url),'utf8'),tests=await readFile(new URL('./design.test.ts',import.meta.url),'utf8');
  for(const control of [
    {from:'check&&check.passed===true&&text(check.command)',to:'check&&text(check.command)',pattern:'apply requires an exact plan'},
    {from:'for(const task of plan.tasks){',to:'for(const task of []){',pattern:'stable IDs produce semantic renames'}
  ]){
    const root=await mkdtemp(join(tmpdir(),'mpfrontend-design-negative-'));
    try{
      assert.ok(source.includes(control.from));await mkdir(join(root,'src'));await mkdir(join(root,'tests'));
      await writeFile(join(root,'package.json'),await readFile(new URL('../package.json',import.meta.url),'utf8'));
      await writeFile(join(root,'src/design.ts'),source.replace(control.from,control.to));await writeFile(join(root,'tests/design.test.ts'),tests);
      const require=createRequire(import.meta.url),env={...process.env};delete env.NODE_TEST_CONTEXT;
      const result=spawnSync(process.execPath,['--import',require.resolve('tsx'),'--test','--test-name-pattern',control.pattern,join(root,'tests/design.test.ts')],{encoding:'utf8',env});
      const output=result.stdout+result.stderr;assert.notEqual(result.status,0);assert.match(output,/AssertionError|ERR_ASSERTION/);assert.match(output,/Missing expected rejection/);
      assert.doesNotMatch(output,/ERR_MODULE_NOT_FOUND|SyntaxError|Cannot find module/);
    }finally{await rm(root,{recursive:true,force:true});}
  }
});

test('all seven actual executable design commands complete the synthetic reviewed-export lifecycle',async()=>{
  const f=await fixture();
  try{
    const imported=cli(['import','--binding',f.config,'--snapshot',f.exportPath]);
    assert.equal(cli(['validate','--binding',f.config,'--candidate',imported.candidateHash]).ok,true);
    assert.equal(cli(['diff','--binding',f.config,'--candidate',imported.candidateHash]).changes.length,2);
    const planned=cli(['plan','--binding',f.config,'--candidate',imported.candidateHash]);
    assert.equal(cli(['apply','--plan',planned.planPath,'--dry-run']).dryRun,true);
    assert.equal(cli(['apply','--plan',planned.planPath]).ok,true);
    const report=await evidence(f.root,planned);
    assert.equal(cli(['accept','--plan',planned.planPath,'--evidence',report]).ok,true);
    assert.equal(cli(['check','--binding',f.config]).scope,'declared-export-only');
    assert.deepEqual(cli(['diff','--binding',f.config,'--candidate',imported.candidateHash]).changes,[]);
    const before=await readFile(join(f.state,'baseline.json'),'utf8');await writeFile(report,'{}');
    cli(['accept','--plan',planned.planPath,'--evidence',report],2);assert.equal(await readFile(join(f.state,'baseline.json'),'utf8'),before);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('unknown, duplicate or misplaced design flags fail before a mistaken dry-run writes anything',async()=>{
  const root=await mkdtemp(join(tmpdir(),'mpfrontend-design-flags-'));
  try{
    const config=join(root,'design.binding.json'),exportPath=join(root,'snapshot.json');
    await writeFile(config,JSON.stringify(binding));await writeFile(exportPath,JSON.stringify(snapshot));const before=await readdir(root);
    for(const extra of [['--dr-run'],['--binding',config],['--force'],['--evidence',exportPath]]){
      cli(['import','--binding',config,'--snapshot',exportPath,...extra],2);assert.deepEqual(await readdir(root),before);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
