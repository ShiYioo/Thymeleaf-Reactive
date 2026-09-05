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

test('compiles keyed each bindings into runtime metadata', () => {
  const result = compileElementAttributes({ 'th:each': 'item in items', 'th:key': 'item.id' });
  assert.deepEqual(result.bindings, [{ kind: 'each', expression: 'item in items' }]);
  assert.deepEqual(result.runtimeAttrs, {
    'data-tr-each': 'item in items',
    'data-tr-key': 'item.id'
  });
});

test('compiles tr aliases used by the Thymeleaf starter', () => {
  const result = compileElementAttributes({
    'tr:component': 'counter',
    'tr:component-src': 'components/Counter.vue',
    'tr:show': 'visible',
    'tr:each': 'item of items'
  });
  assert.equal(result.component, 'counter');
  assert.equal(result.componentSrc, 'components/Counter.vue');
  assert.deepEqual(result.bindings, [
    { kind: 'show', expression: 'visible' },
    { kind: 'each', expression: 'item of items' }
  ]);
  assert.deepEqual(result.runtimeAttrs, {
    'data-tr-component-src': 'components/Counter.vue',
    'data-tr-show': 'visible',
    'data-tr-each': 'item of items'
  });
});

test('compiles component state and props metadata', () => {
  const result = compileElementAttributes({ 'tr:state': '${counter}', 'tr:props': '${props}' });
  assert.deepEqual(result.runtimeAttrs, {
    'data-tr-state': '${counter}',
    'data-tr-props': '${props}'
  });
});

test('compiles reactive html bindings into runtime metadata', () => {
  const result = compileElementAttributes({ 'tr:html': 'content' });
  assert.deepEqual(result.bindings, [{ kind: 'html', expression: 'content' }]);
  assert.deepEqual(result.runtimeAttrs, { 'data-tr-html': 'content' });
});
