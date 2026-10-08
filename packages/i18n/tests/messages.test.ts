import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogs, coreMessages, createMessages, defineMessages, messageArguments, MessageError, translator } from '../src/index.js';

const en = defineMessages({
  items: '{count, plural, one {# item} other {# items}}',
  pageOf: 'Page {page, number} of {count, number}',
  role: '{kind, select, owner {Owner} other {Member}}',
  since: 'Since {day, date, long}',
  greeting: 'Hello {name}',
});
const ar = { items: '{count, plural, zero {لا عناصر} one {عنصر واحد} two {عنصران} few {# عناصر} many {# عنصرًا} other {# عنصر}}', pageOf: 'الصفحة {page, number} من {count, number}', role: '{kind, select, owner {المالك} other {عضو}}', since: 'منذ {day, date, long}', greeting: 'مرحبًا {name}' };
const messages = createMessages({ defaultLocale: 'en', base: en, translations: { ar, fa: { pageOf: en.pageOf, items: en.items, role: en.role, since: en.since, greeting: en.greeting } } });

test('plural and select follow the rules of each locale through Intl.PluralRules', () => {
  const english = messages.translator('en');
  assert.equal(english('items', { count: 1 }), '1 item');
  assert.equal(english('items', { count: 5 }), '5 items');
  const arabic = messages.translator('ar');
  const categories = [0, 1, 2, 3, 11, 100].map(count => new Intl.PluralRules('ar').select(count));
  assert.deepEqual(categories, ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.equal(arabic('items', { count: 0 }), 'لا عناصر');
  assert.equal(arabic('items', { count: 2 }), 'عنصران');
  assert.notEqual(arabic('items', { count: 3 }), arabic('items', { count: 11 }));
  assert.equal(english('role', { kind: 'owner' }), 'Owner');
  assert.equal(english('role', { kind: 'guest' }), 'Member');
});

test('numbers and dates in parameters are formatted by the locale through Intl, and the message places them', () => {
  assert.equal(messages.translator('en')('pageOf', { page: 2, count: 1200 }), 'Page 2 of 1,200');
  const persian = messages.translator('fa')('pageOf', { page: 2, count: 1200 });
  assert.ok(persian.includes(new Intl.NumberFormat('fa').format(1200)), 'Persian digits');
  assert.ok(messages.translator('ar')('pageOf', { page: 2, count: 3 }).startsWith('الصفحة'));
  const day = new Date(Date.UTC(2026, 2, 21, 12));
  assert.ok(messages.translator('en')('since', { day }).includes(new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(day)));
  const latin = createMessages({ defaultLocale: 'en', base: en, translations: { fa: en }, numberingSystem: code => code === 'fa' ? 'latn' : undefined });
  assert.equal(latin.translator('fa')('pageOf', { page: 2, count: 3 }), 'Page 2 of 3');
});

test('a missing argument fails without the values; an unknown locale uses the default', () => {
  const english = messages.translator('en') as unknown as (key: string, values?: Record<string, unknown>) => string;
  assert.throws(() => english('greeting', { other: 'private value' }), (error: Error) => error instanceof MessageError && !error.message.includes('private value'));
  assert.equal(messages.translator('de')('greeting', { name: 'Ada' }), 'Hello Ada');
  assert.equal(messages.locales.join(), 'en,ar,fa');
});

test('core messages are a separate set that a catalog set may override; translator keeps the earlier keys', () => {
  const set = createMessages({ defaultLocale: 'en', base: defineMessages({ back: 'Return' }), translations: {}, core: coreMessages });
  const t = set.translator('en') as unknown as (key: string) => string;
  assert.equal(t('back'), 'Return');
  assert.equal(t('search'), 'Search');
  assert.ok(!('title' in coreMessages.en), 'product text is not a core message');
  assert.equal(translator('en')('refresh'), 'Refresh');
  assert.notEqual(translator('ar')('catalog'), 'Catalog');
});

test('the catalog check finds missing, extra and unused keys and differing parameters', () => {
  assert.deepEqual(messageArguments('{count, plural, one {# in {store}} other {#}}'), { count: 'plural', store: 'text' });
  const problems = checkCatalogs({
    defaultLocale: 'en', locales: ['en', 'ar', 'fa', 'de'],
    catalogs: {
      en: { a: 'Hello {name}', b: 'Total {n, number}', unused: 'Never shown' },
      ar: { a: 'مرحبًا {name}', b: 'المجموع {n, number}' },
      fa: { a: 'Hello {person}', b: 'Total {n}', unused: 'x', extra: 'y' },
    },
    isUsed: key => key !== 'unused',
  });
  assert.deepEqual(problems, [
    { code: 'UNUSED_KEY', key: 'unused' },
    { code: 'MISSING_KEY', locale: 'ar', key: 'unused' },
    { code: 'PARAMETER_MISMATCH', locale: 'fa', key: 'a' },
    { code: 'PARAMETER_MISMATCH', locale: 'fa', key: 'b' },
    { code: 'EXTRA_KEY', locale: 'fa', key: 'extra' },
    { code: 'MISSING_LOCALE', locale: 'de' },
  ]);
  assert.deepEqual(checkCatalogs({ defaultLocale: 'en', locales: ['en'], catalogs: { en: { a: 'Hello {name' } }, isUsed: () => true }), [{ code: 'INVALID_MESSAGE', locale: 'en', key: 'a' }]);
});

test('the digits of the registry apply to a locale that the runtime Intl data does not know', () => {
  // A private-use pseudo-locale tag: Intl resolves it to its default locale and drops a -u-nu- extension.
  const unknown = 'qps-plocm';
  const wide = (n: number) => new Intl.NumberFormat('en', { numberingSystem: 'fullwide' }).format(n);
  const digits = createMessages({ defaultLocale: 'en', base: en, translations: { [unknown]: en }, numberingSystem: code => code === unknown ? 'fullwide' : undefined });
  assert.equal(digits.translator(unknown)('pageOf', { page: 2, count: 3 }), 'Page ' + wide(2) + ' of ' + wide(3));
  assert.equal(digits.translator('en')('pageOf', { page: 2, count: 3 }), 'Page 2 of 3');
});
