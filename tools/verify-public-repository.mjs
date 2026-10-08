import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const ignored=new Set(['.git','node_modules','.nx','.next','dist','artifacts']);
const documents=[];
function visit(directory){
  for(const entry of readdirSync(directory)){
    if(ignored.has(entry))continue;
    const path=join(directory,entry),stat=statSync(path);
    if(stat.isDirectory())visit(path);
    else if(extname(path).toLowerCase()==='.md')documents.push(path);
  }
}
visit(root);

const forbiddenLetters=/[پچژگکی]/u;
const forbiddenMarkers=[
  /ZarX/i,
  /IykZ1LCb9Ubu7gPPFYBhpY/,
  /xCv9hpyi1WV9zzFxS1DT71/,
  /\/Users\/mehdipanahi/,
  /Payment Git/,
];
const failures=[];
const showcaseDigests={
  'tiffin-catalog.png':'fd5077e8446244085e2c352414f848092af558a2f69244462a5f07932f42a99c',
  'tiffin-customer.png':'70e27cfd26564172b8edb25ebb20d79f8b7116b1f5ef88dd2a3e0a9797caab8e',
  'tiffin-identity.png':'979fea0c22327a38fff3cf0d9d7d86aaf4d933a648978405e37ee8c7e2fa2a6b',
  'tiffin-operations.png':'fe82b03ce19d15a987e2d647748a34a4f6c686d012e27a370fa868026f6135d6',
};
function verifyLocalReference(path,target){
  const trimmed=target.trim();
  if(!trimmed||trimmed.startsWith('#')||/^(?:https?:|mailto:)/i.test(trimmed))return;
  const local=trimmed.split('#',1)[0];
  if(local&&!existsSync(resolve(dirname(path),decodeURIComponent(local))))failures.push(`${path}: missing relative link ${trimmed}`);
}
const distributionProject=JSON.parse(readFileSync(join(root,'tools','distribution','project.json'),'utf8'));
const negativeControlDependencies=distributionProject.targets?.['negative-controls']?.dependsOn;
if(!Array.isArray(negativeControlDependencies)||!negativeControlDependencies.includes('^build')){
  failures.push('tools/distribution/project.json: negative-controls must build every declared dependency before isolated execution');
}
for(const path of documents){
  const content=readFileSync(path,'utf8');
  if(forbiddenLetters.test(content))failures.push(`${path}: Persian-specific text is not allowed`);
  for(const marker of forbiddenMarkers)if(marker.test(content))failures.push(`${path}: private marker ${marker} is not allowed`);
  for(const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g))verifyLocalReference(path,match[1]);
  for(const match of content.matchAll(/\b(?:href|src)="([^"]+)"/g))verifyLocalReference(path,match[1]);
}
for(const [name,expected] of Object.entries(showcaseDigests)){
  const path=join(root,'docs','showcase',name);
  if(!existsSync(path)){failures.push(`${path}: required showcase image is missing`);continue;}
  const actual=createHash('sha256').update(readFileSync(path)).digest('hex');
  if(actual!==expected)failures.push(`${path}: showcase image digest mismatch`);
}
if(failures.length){
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`public repository verification passed documents=${documents.length}`);
