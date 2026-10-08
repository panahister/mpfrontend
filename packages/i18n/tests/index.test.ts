import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogs, coreMessages, direction, formatValue, locale, translator } from '../src/index.js';

test('English is the only built-in catalog, and direction derives from the validated locale', () => {
  assert.deepEqual(Object.keys(catalogs), ['en']);
  assert.deepEqual(Object.keys(coreMessages), ['en']);
  assert.equal(direction(locale('en')), 'ltr');
  assert.equal(direction(locale('unknown')), 'ltr');
  assert.equal(translator('en')('refresh'), 'Refresh');
});

test('formatting does not reinterpret opaque values', () => {
  assert.equal(formatValue('001234', 'en'), '001234');
  assert.equal(formatValue(null, 'en'), '—');
});
