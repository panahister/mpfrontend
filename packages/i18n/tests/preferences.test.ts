import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceCookie } from '../src/index.js';

const cookie = createPreferenceCookie({ name: 'mp_preferences', locales: ['en', 'fa'], themes: ['light', 'dark', 'system'] });

test('the preference cookie carries an allowlisted language and theme only', () => {
  assert.equal(cookie.value({ lang: 'fa', theme: 'dark' }), 'lang=fa&theme=dark');
  assert.deepEqual(cookie.parse('lang=fa&theme=dark'), { lang: 'fa', theme: 'dark' });
  assert.deepEqual(cookie.read('other=1; mp_preferences=theme=light&lang=en; last=2'), { lang: 'en', theme: 'light' });
  assert.deepEqual(cookie.read('mp_preferences=lang=fa'), { lang: 'fa' });
});

test('an invalid value is ignored and never echoed', () => {
  for (const value of ['lang=de', 'lang=<script>&theme=dark2', 'theme=dark;lang=fa', 'role=admin&sub=1', 'x'.repeat(300), '', undefined, null]) {
    const parsed = cookie.parse(value);
    assert.ok(Object.values(parsed).every(entry => ['en', 'fa', 'light', 'dark', 'system'].includes(entry!)), String(value));
  }
  assert.deepEqual(cookie.parse('lang=de&theme=dark'), { theme: 'dark' });
  assert.deepEqual(cookie.parse('lang=fa&lang=en'), { lang: 'fa' });
  assert.throws(() => cookie.value({ lang: 'de' }), /INVALID_PREFERENCE_VALUE/);
});

test('the contract refuses an unsafe name or value', () => {
  assert.throws(() => createPreferenceCookie({ name: 'a b', locales: ['en'], themes: [] }), /INVALID_PREFERENCE_COOKIE_NAME/);
  assert.throws(() => createPreferenceCookie({ name: '__Host-prefs', locales: ['en'], themes: [] }), /INVALID_PREFERENCE_COOKIE_NAME/);
  assert.throws(() => createPreferenceCookie({ name: 'prefs', locales: ['en;x'], themes: [] }), /INVALID_PREFERENCE_VALUE/);
});
