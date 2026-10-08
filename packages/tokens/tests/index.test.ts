import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appearance,validBrand,validMode } from '../src/index.js';

test('appearance and consumer-owned branding are independent',()=>{
  const brands=['example-a','example-b'] as const;
  let count=0;
  for(const direction of ['ltr','rtl']) for(const brand of brands)
    for(const [mode,dark,expected] of [['light',true,'light'],['dark',false,'dark'],['system',false,'light'],['system',true,'dark']] as const) {
      assert.equal(appearance(mode,dark),expected);
      assert.equal(validBrand(brand,brands,'example-a'),brand);
      assert.ok(direction);
      count++;
    }
  assert.equal(count,16);
});
test('invalid persisted preferences use only the consumer-approved fallback',()=>{
  assert.equal(validBrand('foreign-tenant',['neutral','custom'],'neutral'),'neutral');
  assert.equal(validMode('evil'),'system');
  assert.throws(()=>validBrand('custom',['custom'],'absent'),/INVALID_BRAND_FALLBACK/);
});
