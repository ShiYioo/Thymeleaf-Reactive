import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive, effect } from './dist/index.js';

test('reactive state tracks and reruns dependent effects', () => {
  const state = reactive({ count: 0, other: 1 });
  let runs = 0; let value;
  effect(() => { runs++; value = state.count; });
  state.other++;
  assert.equal(runs, 1);
  state.count++;
  assert.equal(runs, 2);
  assert.equal(value, 1);
});
