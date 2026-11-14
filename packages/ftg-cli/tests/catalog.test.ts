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

test('a key that code asks a translator for and the base does not define fails the check',async()=>{
  const root=await app({...clean,
    'src/features/review/ui/review.tsx':"import { messages } from '../model/messages';\nconst t = messages.translator('en') as unknown as (key: string) => string;\nexport const heading = [t('heading'), t('ghost')];\n",
    'src/app/layout.tsx':"import { appMessages } from '../i18n';\nconst t = appMessages.translator('en');\nexport const view = [t('title'), t('count', { n: 1 }), t('phantom')];\n",
  });
  try{
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.problems.map(problem=>[problem.catalog,problem.code,problem.key??'']).sort(),[
      ['src/features/review/model/messages','UNDEFINED_KEY','ghost'],
      ['src/i18n/messages','UNDEFINED_KEY','phantom'],
    ]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('messages routes and feature folders are traversed without counting test or catalog definitions as uses',async()=>{
  const root=await app({
    'src/app/messages/page.tsx':"import { appMessages } from '../../i18n';\nconst t = appMessages.translator('en');\nexport const page = t('title');\n",
    'src/i18n/messages/en.ts':base({title:'Messages',testOnly:'testOnly'}),
    'src/i18n/messages/qps-plocm.ts':other({title:'x',testOnly:'y'}),
    'src/features/messages/model/messages/en.ts':base({heading:'Message text'}),
    'src/features/messages/model/messages/qps-plocm.ts':other({heading:'y'}),
    'src/features/messages/model/messages/view/page.tsx':"export const heading = t('heading');\n",
    'src/tests/features/messages/page.test.ts':"export const testOnly = t('testOnly');\n",
  });
  try{
    const result=await catalogCheck(root);
    assert.deepEqual(result.catalogs,['src/features/messages/model/messages','src/i18n/messages']);
    assert.equal(result.keys,3);
    assert.deepEqual(result.problems,[{catalog:'src/i18n/messages',code:'UNUSED_KEY',key:'testOnly'}]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a nested catalog retains missing-default and unknown-locale checks',async()=>{
  const root=await app({
    'src/features/messages/model/messages/qps-plocm.ts':other({heading:'y'}),
    'src/features/messages/model/messages/qaa.ts':other({heading:'z'}),
  });
  try{
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.problems.map(problem=>[problem.catalog,problem.code,problem.locale]).sort(),[
      ['src/features/messages/model/messages','MISSING_LOCALE','en'],
      ['src/features/messages/model/messages','UNKNOWN_LOCALE','qaa'],
    ]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('short source filenames in routes and features named messages are not locales',async()=>{
  const root=await app({
    'src/app/messages/ui.ts':"export const title = t('title');\n",
    'src/i18n/messages/en.ts':base({title:'Messages'}),
    'src/i18n/messages/qps-plocm.ts':other({title:'x'}),
    'src/features/messages/api.ts':"import { messages } from './model/messages';\nconst t = messages.translator('en');\nexport const heading = t('heading');\n",
    'src/features/messages/model/messages/en.ts':base({heading:'Message text'}),
    'src/features/messages/model/messages/qps-plocm.ts':other({heading:'y'}),
  });
  try{
    const result=await catalogCheck(root);
    assert.deepEqual(result.catalogs,['src/features/messages/model/messages','src/i18n/messages']);
    assert.deepEqual(result.problems,[]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a nested catalog containing only the default locale still requires other registered locales',async()=>{
  const root=await app({
    'src/features/messages/model/messages/en.ts':base({heading:'Message text'}),
    'src/features/messages/model/view.ts':"export const heading = t('heading');\n",
  });
  try{
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.problems,[{
      catalog:'src/features/messages/model/messages',code:'MISSING_LOCALE',locale:'qps-plocm',
    }]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a JSON locale is reported even when valid TypeScript catalogs are present',async()=>{
  const root=await app({...clean,'src/i18n/messages/en.json':'{"title":"Unverified translation"}'});
  try{
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.problems,[{catalog:'src/i18n/messages',code:'UNSUPPORTED_CATALOG_FORMAT',locale:'en'}]);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('a JSON-only catalog is discovered below a feature folder named messages',async()=>{
  const root=await app({
    'src/features/messages/messages/en.json':'{"heading":"Messages"}',
    'src/features/messages/messages/qps-plocm.json':'{"heading":"x"}',
  });
  try{
    const result=await catalogCheck(root);
    assert.equal(result.ok,false);
    assert.deepEqual(result.catalogs,['src/features/messages/messages']);
    assert.deepEqual(result.problems.map(problem=>[problem.code,problem.locale]).sort(),[
      ['MISSING_LOCALE','en'],
      ['UNSUPPORTED_CATALOG_FORMAT','en'],
      ['UNSUPPORTED_CATALOG_FORMAT','qps-plocm'],
    ]);
  }finally{await rm(root,{recursive:true,force:true});}
});
