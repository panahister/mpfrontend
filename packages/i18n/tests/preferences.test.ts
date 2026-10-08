import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPreferenceCookie } from '../src/index.js';

// A test fixture, never a built-in locale: a private-use pseudo-locale tag.
const RTL = 'qps-plocm';

const cookie = createPreferenceCookie({ name: 'mp_preferences', locales: ['en', RTL], themes: ['light', 'dark', 'system'] });

test('the preference cookie carries an allowlisted language and theme only', () => {
  assert.equal(cookie.value({ lang: RTL, theme: 'dark' }), 'lang=' + RTL + '&theme=dark');
  assert.deepEqual(cookie.parse('lang=' + RTL + '&theme=dark'), { lang: RTL, theme: 'dark' });
  assert.deepEqual(cookie.read('other=1; mp_preferences=theme=light&lang=en; last=2'), { lang: 'en', theme: 'light' });
  assert.deepEqual(cookie.read('mp_preferences=lang=' + RTL), { lang: RTL });
});

test('an invalid value is ignored and never echoed', () => {
  for (const value of ['lang=qaa', 'lang=<script>&theme=dark2', 'theme=dark;lang=' + RTL, 'role=admin&sub=1', 'x'.repeat(300), '', undefined, null]) {
    const parsed = cookie.parse(value);
    assert.ok(Object.values(parsed).every(entry => ['en', RTL, 'light', 'dark', 'system'].includes(entry!)), String(value));
  }
  assert.deepEqual(cookie.parse('lang=qaa&theme=dark'), { theme: 'dark' });
  assert.deepEqual(cookie.parse('lang=' + RTL + '&lang=en'), { lang: RTL });
  assert.throws(() => cookie.value({ lang: 'qaa' }), /INVALID_PREFERENCE_VALUE/);
});

test('the contract refuses an unsafe name or value', () => {
  assert.throws(() => createPreferenceCookie({ name: 'a b', locales: ['en'], themes: [] }), /INVALID_PREFERENCE_COOKIE_NAME/);
  assert.throws(() => createPreferenceCookie({ name: '__Host-prefs', locales: ['en'], themes: [] }), /INVALID_PREFERENCE_COOKIE_NAME/);
  assert.throws(() => createPreferenceCookie({ name: 'prefs', locales: ['en;x'], themes: [] }), /INVALID_PREFERENCE_VALUE/);
});
