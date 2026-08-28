import test from 'node:test';
import assert from 'node:assert/strict';
import { compileElementAttributes, toRuntimeAttributes } from './src/index.js';

test('compiles reactive Thymeleaf attributes into metadata', () => {
  const result = compileElementAttributes({
    'th:component': 'counter',
    'th:key': 'counter.id',
    'th:text': 'count',
    'th:on': 'click:increment',
    class: 'counter'
  });
  assert.equal(result.component, 'counter');
  assert.equal(result.key, 'counter.id');
  assert.deepEqual(result.bindings, [
    { kind: 'text', expression: 'count' },
    { kind: 'event', event: 'click', handler: 'increment' }
  ]);
  assert.equal(result.attrs.class, 'counter');
  assert.deepEqual(result.runtimeAttrs, {
    'data-tr-key': 'counter.id',
    'data-tr-text': 'count',
    'data-tr-on': 'click:increment'
  });
  assert.deepEqual(toRuntimeAttributes({ 'th:model': 'user.name' }), {
    'data-tr-model': 'user.name'
  });
});

test('compiles dynamic attribute, class, and style bindings', () => {
  const result = compileElementAttributes({
    'th:attr': 'title:user.name',
    'th:class': 'classes',
    'th:style': 'styles'
  });
  assert.deepEqual(result.bindings, [
    { kind: 'attr', expression: 'title:user.name' },
    { kind: 'class', expression: 'classes' },
    { kind: 'style', expression: 'styles' }
  ]);
  assert.deepEqual(result.runtimeAttrs, {
    'data-tr-attr': 'title:user.name',
    'data-tr-class': 'classes',
    'data-tr-style': 'styles'
  });
});
