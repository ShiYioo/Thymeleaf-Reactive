import test from 'node:test';
import assert from 'node:assert/strict';
import { compileElementAttributes } from './src/index.js';

test('compiles reactive Thymeleaf attributes into metadata', () => {
  const result = compileElementAttributes({
    'th:component': 'counter',
    'th:text': 'count',
    'th:on': 'click:increment',
    class: 'counter'
  });
  assert.equal(result.component, 'counter');
  assert.deepEqual(result.bindings, [
    { kind: 'text', expression: 'count' },
    { kind: 'event', event: 'click', handler: 'increment' }
  ]);
  assert.equal(result.attrs.class, 'counter');
});
