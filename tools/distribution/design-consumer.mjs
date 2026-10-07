// Temporary consumer fixtures only. Every design operation uses the installed executable.
import {readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function verifyDesignConsumer({workspace,run}){
  const root=join(workspace,'design-fixture');await mkdir(root);
  const bindingPath=join(root,'design.binding.json'),snapshotPath=join(root,'snapshot.json');
  const binding={schemaVersion:1,id:'fixture',source:{fileKey:'fixture',nodeId:'1:2'},brandId:'fixture',modeAttribute:'data-mode',
    stateDirectory:'.mpfrontend/design/fixture',outputDirectory:'themes/fixture/generated',
    tokens:[{sourceId:'color:surface',cssName:'--mp-surface'}],components:[],ignoredTokens:[],ignoredComponents:[]};
  const snapshot={schemaVersion:1,source:{fileKey:'fixture',nodeId:'1:2',revision:null,capturedAt:'2026-10-07T07:00:00.000Z',extractorVersion:'synthetic-unit-fixture'},modes:['light','dark'],
    tokens:[{id:'color:surface',name:'Surface',type:'color',values:{light:'#ffffff',dark:'#101010'}}],components:[],assets:[]};
  await writeFile(bindingPath,JSON.stringify(binding));await writeFile(snapshotPath,JSON.stringify(snapshot));
  const cli=async(args,expectedCode=0)=>JSON.parse(await run('pnpm',['exec','mpfrontend','design',...args,'--json'],{capture:true,expectedCode}));
  // Rejections go to stderr, so use the non-capturing exit-code path for those commands.
  const reject=async(args,expectedCode)=>run('pnpm',['exec','mpfrontend','design',...args,'--json'],{expectedCode});
  const disabled=await cli(['status']);assert.equal(disabled.source,'none');assert.equal(disabled.status,'disabled');
  const sourceConfig=join(workspace,'.mpfrontend/design-source.json'),sourceBefore=await readFile(sourceConfig);
  const attachArgs=['attach','--source','existing','--binding','design-fixture/design.binding.json'];
  const attachPreview=await cli([...attachArgs,'--dry-run']);assert.deepEqual(attachPreview.changed,['.mpfrontend/design-source.json']);assert.deepEqual(await readFile(sourceConfig),sourceBefore);
  const attached=await cli(attachArgs);assert.equal(attached.source,'existing');assert.equal(attached.releaseVersion,null);
  const attachedStatus=await cli(['status']);assert.equal(attachedStatus.status,'attached');assert.equal(attachedStatus.bindingHash,attached.bindingHash);
  const before=await readdir(root),dry=await cli(['import','--binding',bindingPath,'--snapshot',snapshotPath,'--dry-run']);
  assert.deepEqual(await readdir(root),before);
  const imported=await cli(['import','--binding',bindingPath,'--snapshot',snapshotPath]);assert.equal(imported.candidateHash,dry.candidateHash);
  const candidate=imported.candidateHash,state=join(root,binding.stateDirectory),stored=join(state,'snapshots',candidate+'.json');
  const bytes=await readFile(stored);assert.deepEqual((await cli(['import','--binding',bindingPath,'--snapshot',snapshotPath])).changed,[]);assert.deepEqual(await readFile(stored),bytes);
  await assert.rejects(lstat(join(state,'baseline.json')),{code:'ENOENT'});
  assert.equal((await cli(['validate','--binding',bindingPath,'--candidate',candidate])).sourceRevision,null);
  assert.equal((await cli(['diff','--binding',bindingPath,'--candidate',candidate])).changes[0].action,'added');
  const planned=await cli(['plan','--binding',bindingPath,'--candidate',candidate]),plan=planned.plan;
  await cli(['apply','--plan',planned.planPath,'--dry-run']);await assert.rejects(lstat(join(root,binding.outputDirectory)),{code:'ENOENT'});
  await cli(['apply','--plan',planned.planPath]);await reject(['check','--binding',bindingPath],3);
  await mkdir(join(root,'evidence'));const artifactPath=join(root,'evidence/synthetic-check.txt');
  const artifact='Synthetic lifecycle attestation, not actual visual or production acceptance.\n';await writeFile(artifactPath,artifact);
  const report={schemaVersion:1,planId:plan.planId,candidateHash:candidate,bindingHash:plan.bindingHash,cliVersion:plan.cliVersion,
    review:{approved:true,reviewer:'synthetic-packed-consumer-fixture'},checks:plan.checks.map(name=>({name,passed:false,command:'synthetic acceptance fixture only',artifact:{path:'evidence/synthetic-check.txt',sha256:hash(artifact)}})),tasks:[]};
  const evidencePath=join(root,'evidence/acceptance.json');await writeFile(evidencePath,JSON.stringify(report));
  await reject(['accept','--plan',planned.planPath,'--evidence',evidencePath],3);
  await assert.rejects(lstat(join(state,'baseline.json')),{code:'ENOENT'});
  report.checks.forEach(check=>check.passed=true);await writeFile(evidencePath,JSON.stringify(report));
  await cli(['accept','--plan',planned.planPath,'--evidence',evidencePath,'--dry-run']);await assert.rejects(lstat(join(state,'baseline.json')),{code:'ENOENT'});
  await cli(['accept','--plan',planned.planPath,'--evidence',evidencePath]);assert.equal((await cli(['check','--binding',bindingPath])).scope,'declared-export-only');
  assert.deepEqual((await cli(['diff','--binding',bindingPath,'--candidate',candidate])).changes,[]);
  const accepted=await readFile(join(state,'baseline.json'));await writeFile(artifactPath,'changed after synthetic review');
  await reject(['check','--binding',bindingPath],3);assert.deepEqual(await readFile(join(state,'baseline.json')),accepted);
  console.log(JSON.stringify({stage:'packed-design-lifecycle',ok:true,lifecycleCommands:7,designSourceCommands:4,scope:'synthetic-declared-export-only',actualVisualAcceptance:false}));
}
