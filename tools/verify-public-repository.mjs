import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join, resolve } from 'node:path';

const root=resolve(import.meta.dirname,'..');
const ignored=new Set(['.git','node_modules','.nx','.next','dist','artifacts']);
const documents=[],files=[];
function visit(directory){
  for(const entry of readdirSync(directory)){
    if(ignored.has(entry))continue;
    const path=join(directory,entry),stat=statSync(path);
    if(stat.isDirectory())visit(path);
    else{files.push(path);if(extname(path).toLowerCase()==='.md')documents.push(path);}
  }
}
visit(root);

// The Arabic-script letters of Persian text, written as escapes so that this file holds none of them.
const forbiddenLetters=/[\u067E\u0686\u0698\u06AF\u06A9\u06CC]/u;
// MP Frontend ships English only: no file holds Arabic-script text, a letter of another non-Latin script or
// a non-ASCII decimal digit. A test builds such characters from code points; third-party lock data is exempt.
const nonEnglishText=/\p{Script_Extensions=Arabic}|(?![\p{Script=Latin}])\p{L}|(?![0-9])\p{Nd}/u;
const thirdPartyData=new Set(['pnpm-lock.yaml']);
const binary=new Set(['.png','.jpg','.jpeg','.gif','.webp','.ico','.woff','.woff2','.ttf','.otf','.pdf','.zip','.gz','.tgz']);
// A template ships the English catalog only; a product adds its own locales in its own repository.
const templates='packages/nx-plugin/templates/';
const catalogFile=/(?:^|\/)messages\/([^/]+?)\.(?:ts|tsx|json)(?:\.template)?$/;
function catalogFailure(relative){
  const match=catalogFile.exec(relative);
  return relative.startsWith(templates)&&match&&match[1]!=='en'?relative+': a template catalog other than English is not allowed':undefined;
}
function registryFailure(relative,content){
  if(!relative.startsWith(templates)||!content.includes('createLocaleRegistry('))return undefined;
  const codes=[...content.matchAll(/['"]?([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)['"]?\s*:\s*\{\s*direction\s*:/g)].map(match=>match[1]);
  return codes.length===1&&codes[0]==='en'?undefined:relative+': a template registers English only, found '+(codes.join(', ')||'none');
}
function textFailure(relative,content){
  const lines=content.split('\n');
  for(const [index,line] of lines.entries()){
    const match=nonEnglishText.exec(line);
    if(match)return relative+':'+(index+1)+': non-English text (U+'+match[0].codePointAt(0).toString(16).toUpperCase().padStart(4,'0')+') is not allowed';
  }
  return undefined;
}
const forbiddenMarkers=[
  /ZarX/i,
  /IykZ1LCb9Ubu7gPPFYBhpY/,
  /xCv9hpyi1WV9zzFxS1DT71/,
  /\/Users\/mehdipanahi/,
  /Payment Git/,
];
const failures=[];
// The guard proves on every run that it still detects what it refuses.
const sample=code=>'const text = '+JSON.stringify('Text '+String.fromCodePoint(code))+';';
for(const code of [0x627,0x6f1,0x5d0,0x416,0x3b1,0x4e2d,0x3042,0xac00,0x915,0x966,0xff11]){
  if(!textFailure('sample.ts',sample(code)))failures.push('guard self-check: U+'+code.toString(16)+' was not detected');
}
if(textFailure('sample.ts','English text, 1 -> 2, a dash \u2014 and an arrow \u2192 caf\u00e9'))failures.push('guard self-check: English text was refused');
if(!catalogFailure(templates+'next/src/i18n/messages/xx.ts.template')||catalogFailure(templates+'next/src/i18n/messages/en.ts.template'))failures.push('guard self-check: template catalogs');
if(!registryFailure(templates+'x.ts.template',"createLocaleRegistry({ locales: { en: { direction: 'ltr' }, 'xx-YY': { direction: 'rtl' } } })"))failures.push('guard self-check: template registry');
for(const relative of ['docs/FRONTEND-CONVENTIONS.md']){
  if(!existsSync(join(root,relative)))failures.push(`${relative}: required public guide is missing`);
}
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
for(const path of files){
  const relative=path.slice(root.length+1).split('\\').join('/');
  const catalog=catalogFailure(relative);
  if(catalog)failures.push(catalog);
  if(thirdPartyData.has(relative)||binary.has(extname(path).toLowerCase()))continue;
  const bytes=readFileSync(path);
  if(bytes.includes(0))continue;
  const content=bytes.toString('utf8');
  for(const failure of [textFailure(relative,content),registryFailure(relative,content)])if(failure)failures.push(failure);
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
console.log(`public repository verification passed documents=${documents.length} files=${files.length}`);
