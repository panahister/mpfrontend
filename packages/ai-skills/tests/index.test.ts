import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installSkills,checkSkills,skillCatalog} from '../src/index.js';

test('approved catalog exposes all eighteen finite workflows',()=>{
  const catalog=skillCatalog();assert.equal(catalog.skills.length,18);
  assert.equal(catalog.skills.filter(s=>s.profile==='base').length,14);
  assert.equal(catalog.skills.filter(s=>s.available).length,18);
  assert.deepEqual(catalog.skills.filter(s=>!s.available),[]);
});
test('newly completed workflows contain executable boundaries, named packages and refusal rules',async()=>{
  const requirements={
    'implement-feature':['@mpfrontend/access-core','generated-check','never invent'],
    'integrate-auth':['@mpfrontend/security-bff','PKCE','Do not create or mutate Keycloak'],
    'apply-access':['AuthorityFence','stale-token','identity-administration writes'],
    'integrate-realtime':['@mpfrontend/realtime-core','onSnapshot','broker topics'],
    'upgrade-project':['skills update','frozen install','does not authorize commits'],
    'prepare-release':['fresh independent consumer','workspace:','Stop before `git init`']
  } as const;
  for(const [name,markers] of Object.entries(requirements)){
    const source=await readFile(new URL('../skills/mpfrontend-'+name+'/SKILL.md',import.meta.url),'utf8');
    for(const marker of markers)assert.ok(source.includes(marker),name+' must include '+marker);
  }
});
test('design-aware workflows preserve explicit source selection and never infer Figma writes',async()=>{
  const requirements={
    'scaffold-app':['--design-source <existing|none>','neither imports a snapshot nor approves a baseline'],
    'import-design-system':['design status','--source existing','consumer owns'],
    'sync-design-tokens':['attached design source','pending, disabled or drifted'],
    'reconcile-design-components':['design status','pending/disabled'],
    'review-design-drift':['read-only `mpfrontend design status','Do not attach, switch modes'],
    'prepare-release':['both MVP design-source init contracts','without public-release metadata']
  } as const;
  for(const [name,markers] of Object.entries(requirements)){
    const source=await readFile(new URL('../skills/mpfrontend-'+name+'/SKILL.md',import.meta.url),'utf8');
    for(const marker of markers)assert.ok(source.includes(marker),name+' must include '+marker);
  }
});
test('dry-run, dual-agent install, idempotency, update and authored instructions preservation',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-skills-'));
  try{
    await writeFile(join(directory,'AGENTS.md'),'consumer rules');await writeFile(join(directory,'CLAUDE.md'),'consumer import');
    const before=await readdir(directory),plan=await installSkills({directory,dryRun:true});
    assert.equal(plan.changes.length,29);assert.deepEqual(await readdir(directory),before);
    const result=await installSkills({directory});assert.equal(result.installed.length,14);assert.equal(result.unavailable.length,0);
    assert.equal((await checkSkills(directory)).checked,28);
    assert.deepEqual((await installSkills({directory})).changes,[]);
    assert.deepEqual((await installSkills({directory,update:true})).changes,[]);
    assert.equal(await readFile(join(directory,'AGENTS.md'),'utf8'),'consumer rules');
    assert.equal(await readFile(join(directory,'CLAUDE.md'),'utf8'),'consumer import');
    for(const name of result.installed)assert.equal(await readFile(join(directory,'.agents/skills',name,'SKILL.md'),'utf8'),await readFile(join(directory,'.claude/skills',name,'SKILL.md'),'utf8'));
    const path=join(directory,'.agents/skills/mpfrontend-scaffold-app/SKILL.md');await writeFile(path,'authored change');
    await assert.rejects(()=>checkSkills(directory),/INSTALLED_SKILL_DRIFT/);
    const lock=await readFile(join(directory,'.mpfrontend/skills-lock.json'),'utf8');
    await assert.rejects(()=>installSkills({directory,update:true}),/MODIFIED_OR_UNOWNED_SKILL/);
    assert.equal(await readFile(path,'utf8'),'authored change');assert.equal(await readFile(join(directory,'.mpfrontend/skills-lock.json'),'utf8'),lock);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('unowned collision and symlink parents fail before any write; unrelated skills survive',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-skills-collision-'));
  try{
    await mkdir(join(directory,'outside'),{recursive:true});await symlink(join(directory,'outside'),join(directory,'.agents'),'dir');
    await assert.rejects(()=>installSkills({directory}),/SKILL_PATH_SYMLINK/);assert.deepEqual(await readdir(join(directory,'outside')),[]);
    await rm(join(directory,'.agents'));await mkdir(join(directory,'.agents/skills/mpfrontend-scaffold-app'),{recursive:true});
    const owned=join(directory,'.agents/skills/mpfrontend-scaffold-app/SKILL.md');await writeFile(owned,'unowned instructions');
    await assert.rejects(()=>installSkills({directory}),/MODIFIED_OR_UNOWNED_SKILL/);assert.equal(await readFile(owned,'utf8'),'unowned instructions');
    await rm(owned);await mkdir(join(directory,'.agents/skills/custom-skill'),{recursive:true});await writeFile(join(directory,'.agents/skills/custom-skill/SKILL.md'),'other skill');
    await installSkills({directory,agent:'codex',profile:'design'});assert.equal((await checkSkills(directory)).checked,18);
    assert.equal(await readFile(join(directory,'.agents/skills/custom-skill/SKILL.md'),'utf8'),'other skill');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('incomplete, stale and traversal-bearing ownership manifests are rejected',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-skills-lock-'));
  try{
    await assert.rejects(()=>installSkills({directory,update:true}),/SKILLS_NOT_INSTALLED/);
    await installSkills({directory});const path=join(directory,'.mpfrontend/skills-lock.json'),bytes=await readFile(path,'utf8');
    const lock=JSON.parse(bytes);delete lock.files[Object.keys(lock.files)[0]!];await writeFile(path,JSON.stringify(lock));
    await assert.rejects(()=>checkSkills(directory),/INCOMPLETE_SKILLS_LOCK/);
    await writeFile(path,JSON.stringify({...JSON.parse(bytes),version:'old'}));await assert.rejects(()=>checkSkills(directory),/SKILLS_VERSION_MISMATCH/);
    await writeFile(path,JSON.stringify({...JSON.parse(bytes),files:{'../AGENTS.md':'0'.repeat(64)}}));
    await assert.rejects(()=>installSkills({directory}),/INVALID_SKILLS_LOCK/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('a concurrent or interrupted skill installation is refused without changing either owner',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mpfrontend-skills-busy-'));
  try{
    await mkdir(join(directory,'.mpfrontend'));
    const marker=join(directory,'.mpfrontend/skills-install.lock');
    await writeFile(marker,'another installation owns this marker');
    await assert.rejects(()=>installSkills({directory}),/SKILLS_INSTALL_BUSY/);
    assert.equal(await readFile(marker,'utf8'),'another installation owns this marker');
    assert.deepEqual(await readdir(directory),['.mpfrontend']);
    await rm(marker);await installSkills({directory});
    assert.equal((await checkSkills(directory)).checked,28);
    assert.ok(!(await readdir(join(directory,'.mpfrontend'))).includes('skills-install.lock'));
    await writeFile(marker,'interrupted installation needs inspection');
    await assert.rejects(()=>checkSkills(directory),/SKILLS_INSTALL_BUSY/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
