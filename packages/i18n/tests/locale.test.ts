import { test } from 'node:test';
import assert from 'node:assert/strict';
import { builtInLocales, createLocaleRegistry, direction, formatNumber, formatValue, locale, locales, negotiateLocale, translator } from '../src/index.js';

test('en, ar and fa ship; fa is right-to-left and the existing locales are unchanged', () => {
  assert.deepEqual(Object.keys(builtInLocales), ['en', 'ar', 'fa']);
  assert.equal(locale('ar'), 'ar');
  assert.equal(locale('en'), 'en');
  assert.equal(locale('fa'), 'fa');
  assert.equal(direction(locale('fa')), 'rtl');
  assert.equal(direction(locale('ar')), 'rtl');
  assert.equal(direction(locale('en')), 'ltr');
});

test('an unknown locale falls back to the configured default', () => {
  for (const value of ['de', 'FA', 'fa-IR', '', null, 7, '<x>']) assert.equal(locale(value), 'en', String(value));
  const persianFirst = createLocaleRegistry({ locales: { fa: { direction: 'rtl' }, en: { direction: 'ltr' } }, defaultLocale: 'fa' });
  assert.equal(persianFirst.locale('de'), 'fa');
  assert.equal(persianFirst.direction('de'), 'rtl');
  assert.equal(locales.defaultLocale, 'en');
});

test('a consumer adds a locale by configuration and its direction comes from the registry', () => {
  const registry = createLocaleRegistry({ locales: { en: { direction: 'ltr' }, he: { direction: 'rtl' } } });
  assert.equal(registry.defaultLocale, 'en');
  assert.equal(registry.locale('he'), 'he');
  assert.equal(registry.direction('he'), 'rtl');
  assert.throws(() => createLocaleRegistry({ locales: { fa: { direction: 'rtl' } } }), /INVALID_DEFAULT_LOCALE/);
  assert.throws(() => createLocaleRegistry({ locales: { 'en x': { direction: 'ltr' } } as never }), /INVALID_LOCALE_DEFINITION/);
  assert.throws(() => createLocaleRegistry({ locales: { en: { direction: 'up' } } as never }), /INVALID_LOCALE_DEFINITION/);
});

test('Accept-Language is negotiated against the allowlist and never returned as given', () => {
  const supported = ['fa', 'en'] as const;
  assert.equal(negotiateLocale('fa-IR,fa;q=0.9,en;q=0.8', supported, 'en'), 'fa');
  assert.equal(negotiateLocale('en-US,en;q=0.9', supported, 'fa'), 'en');
  assert.equal(negotiateLocale('de, fr;q=0.8', supported, 'fa'), 'fa');
  assert.equal(negotiateLocale('en;q=0.2, fa;q=0.9', supported, 'en'), 'fa');
  assert.equal(negotiateLocale('fa;q=0, en', supported, 'fa'), 'en');
  assert.equal(negotiateLocale('*', supported, 'fa'), 'fa');
  for (const crafted of ['fa\r\nX-Injected: 1', '<script>', 'fa;q=2', 'x'.repeat(300), Array(20).fill('en').join(','), undefined, null]) {
    const result = negotiateLocale(crafted, supported, 'fa');
    assert.ok(supported.includes(result), String(crafted));
  }
  assert.equal(negotiateLocale('fa\r\nX-Injected: 1', supported, 'en'), 'en');
});

test('numbers use the digits of the locale through Intl; text is never reinterpreted', () => {
  assert.equal(formatNumber(1234.5, 'en'), new Intl.NumberFormat('en').format(1234.5));
  assert.equal(formatNumber(1234.5, 'fa'), new Intl.NumberFormat('fa').format(1234.5));
  assert.notEqual(formatNumber(1234.5, 'fa'), formatNumber(1234.5, 'en'), 'fa uses its own digits');
  assert.equal(formatValue('001234', 'fa'), '001234');
  const latinDigits = createLocaleRegistry({ locales: { en: { direction: 'ltr' }, fa: { direction: 'rtl', numberingSystem: 'latn' } } });
  assert.equal(formatNumber(1234, 'fa', {}, latinDigits), new Intl.NumberFormat('fa', { numberingSystem: 'latn' }).format(1234));
});

test('a missing message falls back key by key to the default locale', () => {
  assert.equal(translator('fa')('refresh'), 'Refresh');
  assert.notEqual(translator('ar')('refresh'), 'Refresh');
  assert.equal(translator('unknown')('back'), 'Back');
});
