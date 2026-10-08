import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogs, coreMessages, createMessages, defineMessages, messageArguments, MessageError, translator, type Catalog } from '../src/index.js';

// Test fixtures, never built-in locales: private-use pseudo-locale tags (BCP 47 reserves the language
// subtags qaa to qtz for private use). Their text is English, marked, so that it cannot be mistaken for a
// fallback to the base catalog.
const RTL = 'qps-plocm', LTR = 'qps-ploc';
const mark = <M extends Catalog>(catalog: M, marker = '[rtl] ') =>
  Object.fromEntries(Object.entries(catalog).map(([key, message]) => [key, marker + message])) as { [K in keyof M]: string };

const en = defineMessages({
  items: '{count, plural, one {# item} other {# items}}',
  place: '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}',
  pageOf: 'Page {page, number} of {count, number}',
  role: '{kind, select, owner {Owner} other {Member}}',
  since: 'Since {day, date, long}',
  greeting: 'Hello {name}',
});
const messages = createMessages({ defaultLocale: 'en', base: en, translations: { [RTL]: mark(en) } });

test('plural, selectordinal and select follow the rules of the locale through Intl.PluralRules', () => {
  const english = messages.translator('en');
  assert.equal(english('items', { count: 1 }), '1 item');
  assert.equal(english('items', { count: 5 }), '5 items');
  assert.deepEqual([1, 2, 3, 4, 11, 22, 103].map(n => english('place', { n })), ['1st', '2nd', '3rd', '4th', '11th', '22nd', '103rd']);
  assert.equal(english('role', { kind: 'owner' }), 'Owner');
  assert.equal(english('role', { kind: 'guest' }), 'Member');
  assert.equal(messages.translator(RTL)('items', { count: 1 }), '[rtl] 1 item');
});

test('numbers and dates in parameters are formatted by the locale through Intl, and the message places them', () => {
  assert.equal(messages.translator('en')('pageOf', { page: 2, count: 1200 }), 'Page 2 of 1,200');
  const day = new Date(Date.UTC(2026, 2, 21, 12));
  assert.ok(messages.translator('en')('since', { day }).includes(new Intl.DateTimeFormat('en', { dateStyle: 'long' }).format(day)));
  const wide = (n: number) => new Intl.NumberFormat('en', { numberingSystem: 'fullwide' }).format(n);
  const digits = createMessages({ defaultLocale: 'en', base: en, translations: { [RTL]: mark(en) }, numberingSystem: code => code === RTL ? 'fullwide' : undefined });
  assert.equal(digits.translator(RTL)('pageOf', { page: 2, count: 3 }), '[rtl] Page ' + wide(2) + ' of ' + wide(3));
  assert.equal(digits.translator('en')('pageOf', { page: 2, count: 3 }), 'Page 2 of 3');
});

test('a missing argument fails without the values; an unknown locale uses the default', () => {
  const english = messages.translator('en') as unknown as (key: string, values?: Record<string, unknown>) => string;
  assert.throws(() => english('greeting', { other: 'private value' }), (error: Error) => error instanceof MessageError && !error.message.includes('private value'));
  assert.equal(messages.translator('qaa')('greeting', { name: 'Ada' }), 'Hello Ada');
  assert.equal(messages.locales.join(), 'en,' + RTL);
});

test('a product locale can be the default and the only locale, and its text is never replaced by English', () => {
  // The product overrides every neutral message and adds its own; English is not one of its locales.
  const base = defineMessages({ ...mark(coreMessages.en), title: '[rtl] Orders', count: '[rtl] {n, plural, one {# order} other {# orders}}' });
  const product = createMessages({ defaultLocale: RTL, base, translations: {}, core: coreMessages });
  assert.deepEqual(product.locales, [RTL]);
  for (const requested of [RTL, 'en', 'qaa']) {
    const t = product.translator(requested);
    for (const [key, message] of Object.entries(coreMessages.en)) assert.equal(t(key as keyof typeof base), '[rtl] ' + message, key);
    assert.equal(t('title'), '[rtl] Orders');
    assert.equal(t('count', { n: 2 }), '[rtl] 2 orders');
  }
  // A neutral message the product did not supply is missing, never English.
  const partial = createMessages({ defaultLocale: RTL, base: defineMessages({ back: '[rtl] Back' }), translations: {}, core: coreMessages });
  const t = partial.translator('en') as unknown as (key: string) => string;
  assert.equal(t('back'), '[rtl] Back');
  assert.throws(() => t('search'), /UNKNOWN_MESSAGE:search/);
});

test('core messages are a separate set that a catalog set may override; translator keeps the earlier keys', () => {
  const set = createMessages({ defaultLocale: 'en', base: defineMessages({ back: 'Return' }), translations: {}, core: coreMessages });
  const t = set.translator('en') as unknown as (key: string) => string;
  assert.equal(t('back'), 'Return');
  assert.equal(t('search'), 'Search');
  assert.ok(!('title' in coreMessages.en), 'product text is not a core message');
  assert.equal(translator('en')('refresh'), 'Refresh');
});

test('the catalog check finds missing, extra and unused keys and differing parameters', () => {
  assert.deepEqual(messageArguments('{count, plural, one {# in {store}} other {#}}'), { count: 'plural', store: 'text' });
  const problems = checkCatalogs({
    defaultLocale: 'en', locales: ['en', RTL, LTR, 'qaa'],
    catalogs: {
      en: { a: 'Hello {name}', b: 'Total {n, number}', unused: 'Never shown' },
      [RTL]: { a: '[rtl] Hello {name}', b: '[rtl] Total {n, number}' },
      [LTR]: { a: '[ltr] Hello {person}', b: '[ltr] Total {n}', unused: 'x', extra: 'y' },
    },
    isUsed: key => key !== 'unused',
  });
  assert.deepEqual(problems, [
    { code: 'UNUSED_KEY', key: 'unused' },
    { code: 'MISSING_KEY', locale: RTL, key: 'unused' },
    { code: 'PARAMETER_MISMATCH', locale: LTR, key: 'a' },
    { code: 'PARAMETER_MISMATCH', locale: LTR, key: 'b' },
    { code: 'EXTRA_KEY', locale: LTR, key: 'extra' },
    { code: 'MISSING_LOCALE', locale: 'qaa' },
  ]);
  assert.deepEqual(checkCatalogs({ defaultLocale: 'en', locales: ['en'], catalogs: { en: { a: 'Hello {name' } }, isUsed: () => true }), [{ code: 'INVALID_MESSAGE', locale: 'en', key: 'a' }]);
  // A product whose only locale is its own is checked the same way: its catalog is the base.
  assert.deepEqual(checkCatalogs({ defaultLocale: RTL, locales: [RTL], catalogs: { [RTL]: { a: '[rtl] Hello {name}' } }, isUsed: () => true }), []);
  assert.deepEqual(checkCatalogs({ defaultLocale: RTL, locales: [RTL], catalogs: { en: { a: 'Hello {name}' } }, isUsed: () => true }), [{ code: 'MISSING_LOCALE', locale: RTL }]);
});
