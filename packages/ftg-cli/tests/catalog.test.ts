import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogCheck} from '../src/catalog.js';

// The second locale is a test fixture, a private-use pseudo-locale tag, never a built-in locale.
// The app lives under this package's dependency folder, so that `@mpfrontend/i18n` resolves as in an app.
const cache=fileURLToPath(new URL('../node_modules/.cache/',import.meta.url));
const registry="import { createLocaleRegistry } from '@mpfrontend/i18n';\nexport const localeRegistry = createLocaleRegistry({ locales: { en: { direction: 'ltr' }, 'qps-plocm': { direction: 'rtl' } }, defaultLocale: 'en' });\n";
const base=(entries:Record<string,string>)=>"import { defineMessages } from '@mpfrontend/i18n';\nexport default defineMessages("+JSON.stringify(entries)+");\n";
const other=(entries:Record<string,string>)=>"import type { Translation } from '@mpfrontend/i18n';\nimport type base from './en';\nexport default "+JSON.stringify(entries)+" satisfies Translation<typeof base>;\n";
async function app(files:Record<string,string>){
  await mkdir(cache,{recursive:true});
  const root=await mkdtemp(join(cache,'catalog-app-'));
  await writeFile(join(root,'package.json'),JSON.stringify({type:'module'}));
  for(const [path,content] of Object.entries({'src/config/app.ts':registry,...files})){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),content);}
  return root;
}
const clean={
  'src/i18n/messages/en.ts':base({title:'Orders',count:'{n, plural, one {# order} other {# orders}}'}),
  'src/i18n/messages/qps-plocm.ts':other({title:'x',count:'{n, plural, other {# x}}'}),
  'src/app/page.tsx':"export const view = [t('title'), t('count', { n: 1 })];\n",
  'src/features/review/model/messages/en.ts':base({heading:'Review'}),
  'src/features/review/model/messages/qps-plocm.ts':other({heading:'y'}),
  'src/features/review/ui/review.tsx':"export const heading = t('heading');\n",
};

test('a complete catalog of every registry locale, used by code, passes',async()=>{
  const root=await app(clean);
  try{
    const result=await catalogCheck(root);
    assert.deepEqual(result.problems,[]);assert.equal(result.ok,true);
    assert.deepEqual(result.catalogs,['src/features/review/model/messages','src/i18n/messages']);
    assert.equal(result.keys,3);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a missing key, an unused key, a differing parameter and a missing locale fail the check',async()=>{
  const root=await app({...clean,
    'src/i18n/messages/en.ts':base({title:'Orders',count:'{n, plural, one {# order} other {# orders}}',spare:'Never used'}),
    'src/i18n/messages/qps-plocm.ts':other({title:'x {name}',count:'{n, plural, other {# x}}'}),
  });
  try{
    await rm(join(root,'src/features/review/model/messages/qps-plocm.ts'));
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.problems.map(problem=>[problem.catalog,problem.code,problem.locale??'',problem.key??'']).sort(),[
      ['src/features/review/model/messages','MISSING_LOCALE','qps-plocm',''],
      ['src/i18n/messages','MISSING_KEY','qps-plocm','spare'],
      ['src/i18n/messages','PARAMETER_MISMATCH','qps-plocm','title'],
      ['src/i18n/messages','UNUSED_KEY','','spare'],
    ]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a feature catalog counts only the uses inside that feature',async()=>{
  const root=await app({...clean,'src/features/review/ui/review.tsx':'export const nothing = 1;\n','src/app/other.tsx':"export const heading = 'heading';\n"});
  try{
    const result=await catalogCheck(root);
    assert.deepEqual(result.problems.map(problem=>problem.code+':'+problem.key),['UNUSED_KEY:heading']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('an app without a readable locale registry is refused',async()=>{
  const root=await app({'src/config/app.ts':'export const other = 1;\n'});
  try{await assert.rejects(catalogCheck(root),/LOCALE_REGISTRY_UNREADABLE/);}
  finally{await rm(root,{recursive:true,force:true});}
});
