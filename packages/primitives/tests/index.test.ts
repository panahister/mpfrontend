import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buttonState,fieldState,isControlUnavailable} from '../src/index.js';

test('button state resolves restrictive states in a deterministic order',()=>{
  assert.equal(buttonState({disabled:true,loading:true,restricted:true}),'restricted');
  assert.equal(buttonState({disabled:true,loading:true}),'loading');
  assert.equal(buttonState({disabled:true}),'disabled');
  assert.equal(isControlUnavailable(buttonState({})),false);
});

test('field state never lets invalid presentation override disabled or readonly behavior',()=>{
  assert.equal(fieldState({disabled:true,readOnly:true,invalid:true}),'disabled');
  assert.equal(fieldState({readOnly:true,invalid:true}),'readonly');
  assert.equal(fieldState({invalid:true}),'error');
});
