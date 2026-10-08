import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInLocales, createLocaleRegistry, direction, formatNumber, formatValue, locale, locales, negotiateLocale, translator, type LocaleOf } from '../src/index.js';

// A test fixture, never a built-in locale: a private-use pseudo-locale tag (BCP 47 reserves the language
// subtags qaa to qtz for private use), written right to left. Its text is English, marked, so that a
// product's text can never be mistaken for a framework fallback.
const RTL = 'qps-plocm';

test('English is the only built-in locale, and the default', () => {
  assert.deepEqual(Object.keys(builtInLocales), ['en']);
  assert.deepEqual(locales.locales, ['en']);
  assert.equal(locales.defaultLocale, 'en');
  assert.equal(direction(locale('en')), 'ltr');
  for (const value of [RTL, 'qaa', 'EN', 'en-US', '', null, 7, '<x>']) assert.equal(locale(value), 'en', String(value));
  assert.equal(direction(RTL), 'ltr', 'the fixture locale is not built in');
});

test('a product registers its own locale with its direction, and English stays the default when unset', () => {
  const registry = createLocaleRegistry({ locales: { en: { direction: 'ltr' }, [RTL]: { direction: 'rtl' } } });
  assert.equal(registry.defaultLocale, 'en');
  assert.equal(registry.locale(RTL), RTL);
  assert.equal(registry.direction(RTL), 'rtl');
  assert.equal(registry.locale('qaa'), 'en');
  assert.equal(registry.direction('qaa'), 'ltr');
  assert.throws(() => createLocaleRegistry({ locales: { 'en x': { direction: 'ltr' } } as never }), /INVALID_LOCALE_DEFINITION/);
  assert.throws(() => createLocaleRegistry({ locales: { en: { direction: 'up' } } as never }), /INVALID_LOCALE_DEFINITION/);
  assert.throws(() => createLocaleRegistry({ locales: { en: { direction: 'ltr', numberingSystem: 'x y' } } }), /INVALID_LOCALE_DEFINITION/);
});

test('a product locale can be the default and the only locale, and the default direction follows it', () => {
  const registry = createLocaleRegistry({ locales: { [RTL]: { direction: 'rtl' } }, defaultLocale: RTL });
  const code: LocaleOf<typeof registry> = registry.defaultLocale;
  assert.equal(code, RTL);
  assert.deepEqual(registry.locales, [RTL]);
  assert.equal(registry.locale('en'), RTL, 'English is not registered');
  assert.equal(registry.direction('en'), 'rtl');
  assert.equal(registry.direction('qaa'), 'rtl');
  assert.equal(registry.negotiate('en-US,en;q=0.9'), RTL);
  // A registry without English names its default.
  assert.throws(() => createLocaleRegistry({ locales: { [RTL]: { direction: 'rtl' } } }), /INVALID_DEFAULT_LOCALE/);
  assert.throws(() => createLocaleRegistry({ locales: { [RTL]: { direction: 'rtl' } }, defaultLocale: 'en' as never }), /INVALID_DEFAULT_LOCALE/);
});

test('Accept-Language is negotiated against the allowlist and never returned as given', () => {
  const supported = [RTL, 'en'] as const;
  assert.equal(negotiateLocale(RTL + ',en;q=0.8', supported, 'en'), RTL);
  assert.equal(negotiateLocale('QPS-PLOCM', supported, 'en'), RTL);
  assert.equal(negotiateLocale('en-GB,en;q=0.9', supported, RTL), 'en', 'the primary language of a range');
  assert.equal(negotiateLocale('qaa, qab;q=0.8', supported, RTL), RTL);
  assert.equal(negotiateLocale('en;q=0.2, ' + RTL + ';q=0.9', supported, 'en'), RTL);
  assert.equal(negotiateLocale(RTL + ';q=0, en', supported, RTL), 'en');
  assert.equal(negotiateLocale('*', supported, RTL), RTL);
  for (const crafted of [RTL + '\r\nX-Injected: 1', '<script>', RTL + ';q=2', 'x'.repeat(300), Array(20).fill('en').join(','), undefined, null]) {
    const result = negotiateLocale(crafted, supported, RTL);
    assert.ok(supported.includes(result), String(crafted));
  }
  assert.equal(negotiateLocale(RTL + '\r\nX-Injected: 1', supported, 'en'), 'en');
  assert.throws(() => negotiateLocale('en', supported, 'qaa' as never), /INVALID_DEFAULT_LOCALE/);
});

test('numbers use the digits that the registry configures through Intl; text is never reinterpreted', () => {
  assert.equal(formatNumber(1234.5, 'en'), new Intl.NumberFormat('en').format(1234.5));
  const registry = createLocaleRegistry({ locales: { en: { direction: 'ltr' }, [RTL]: { direction: 'rtl', numberingSystem: 'fullwide' } } });
  const wide = formatNumber(1234, RTL, {}, registry);
  assert.equal(wide, new Intl.NumberFormat(RTL, { numberingSystem: 'fullwide', maximumFractionDigits: 8 }).format(1234));
  assert.doesNotMatch(wide, /[0-9]/, 'the configured digits are used');
  assert.equal(formatNumber(1234, 'en', {}, registry), new Intl.NumberFormat('en').format(1234));
  assert.equal(formatValue('001234', RTL, registry), '001234');
  assert.equal(formatNumber(1234.5, RTL), formatNumber(1234.5, 'en'), 'the built-in registry knows English only');
});

test('a boolean is shown with the product text when given, and in English otherwise', () => {
  assert.equal(formatValue(true, 'en'), 'Yes');
  assert.equal(formatValue(false, RTL), 'No');
  const labels = { true: '[rtl] Yes', false: '[rtl] No' };
  assert.equal(formatValue(true, RTL, locales, labels), '[rtl] Yes');
  assert.equal(formatValue(false, RTL, locales, labels), '[rtl] No');
});

test('the built-in messages are English; any other locale falls back to them key by key', () => {
  assert.equal(translator('en')('refresh'), 'Refresh');
  assert.equal(translator(RTL)('back'), 'Back');
  assert.equal(translator('unknown')('back'), 'Back');
});
