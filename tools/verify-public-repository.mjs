import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
for(const path of documents){
  const content=readFileSync(path,'utf8');
  if(forbiddenLetters.test(content))failures.push(`${path}: Persian-specific text is not allowed`);
  for(const marker of forbiddenMarkers)if(marker.test(content))failures.push(`${path}: private marker ${marker} is not allowed`);
  for(const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
    const target=match[1].trim();
    if(!target||target.startsWith('#')||/^(?:https?:|mailto:)/i.test(target))continue;
    const local=target.split('#',1)[0];
    if(local&&!existsSync(resolve(dirname(path),decodeURIComponent(local))))failures.push(`${path}: missing relative link ${target}`);
  }
}
if(failures.length){
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`public repository verification passed documents=${documents.length}`);
