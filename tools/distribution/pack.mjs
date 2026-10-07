import {readdir, readFile, mkdir, writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const exec=promisify(execFile);
const root=fileURLToPath(new URL('../../',import.meta.url));
const destination=join(root,'artifacts/packages');
const records=[];
for(const name of (await readdir(join(root,'packages'))).sort()) {
  const directory=join(root,'packages',name);
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  if(!manifest.name.startsWith('@mpfrontend/')||manifest.private)throw new Error('INVALID_DISTRIBUTION_PACKAGE');
  records.push({directory,manifest});
}
await mkdir(destination,{recursive:true});
const inventory=[];
for(const {directory,manifest} of records) {
  await exec('pnpm',['pack','--pack-destination',destination],{cwd:directory,maxBuffer:1048576,
    env:{...process.env,pnpm_config_verify_deps_before_run:'false'}});
  const file=manifest.name.replace('@','').replace('/','-')+'-'+manifest.version+'.tgz';
  const archive=join(destination,file);
  const packed=JSON.parse((await exec('tar',['-xOf',archive,'package/package.json'])).stdout);
  const entries=new Set((await exec('tar',['-tzf',archive])).stdout.trim().split('\n'));
  const exported=[];
  function paths(value){if(typeof value==='string'&&value.startsWith('./'))exported.push(value);
    else if(value&&typeof value==='object')Object.values(value).forEach(paths);}
  paths(packed.exports);paths(packed.main);paths(packed.types);paths(packed.bin);
  for(const path of exported)if(!entries.has('package/'+path.slice(2)))throw new Error('MISSING_PACKED_EXPORT:'+packed.name+':'+path);
  for(const [dependency,version] of Object.entries(packed.dependencies??{})){
    if(String(version).startsWith('workspace:')||String(version).startsWith('file:'))throw new Error('NONPORTABLE_PACKAGE_DEPENDENCY');
    const local=records.find(r=>r.manifest.name===dependency);
    if(local&&version!==local.manifest.version)throw new Error('PACKAGE_COHORT_MISMATCH');
  }
  if([...entries].some(path=>path.includes('node_modules/')||/\/\.env(?:\.|$)/.test(path)||path.endsWith('.key')))
    throw new Error('UNSAFE_PACKAGE_CONTENT');
  const bytes=await readFile(archive);
  inventory.push({name:packed.name,version:packed.version,file,sha256:createHash('sha256').update(bytes).digest('hex'),exports:exported.length});
}
await writeFile(join(destination,'inventory.json'),JSON.stringify({schemaVersion:1,packages:inventory},null,2)+'\n');
console.log(JSON.stringify({ok:true,packed:inventory.length,packages:inventory.map(p=>({name:p.name,version:p.version}))}));
