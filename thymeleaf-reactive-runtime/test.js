import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { adoptComponentRoot, reactive, ref, shallowRef, triggerRef, effect, computed, compileSfcComponent, connectComponentHmr, createApp, defineAsyncComponent, defineComponent, effectScope, Fragment, KeepAlive, Suspense, Transition, TransitionGroup, h, hotUpdate, hydrate, hydrateRender, isMemoSame, nextTick, onActivated, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onDeactivated, onScopeDispose, refreshComponentsFromPage, render, Teleport, inject, isRef, onMounted, onUnmounted, onUpdated, provide, proxyRefs, toRef, toRefs, unref, watch, watchEffect, withMemo } from './dist/index.js';

function installDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.DOMParser = window.DOMParser;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  return window.document;
}

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

test('computed values cache work and propagate invalidation to effects', () => {
  const state = reactive({ count: 1 });
  let evaluations = 0;
  const doubled = computed(() => { evaluations++; return state.count * 2; });
  assert.equal(evaluations, 0);
  assert.equal(doubled.value, 2);
  assert.equal(doubled.value, 2);
  assert.equal(evaluations, 1);
  let observed = 0;
  const runner = effect(() => { observed = doubled.value; });
  assert.equal(observed, 2);
  state.count = 2;
  assert.equal(observed, 4);
  assert.equal(evaluations, 2);
  runner.stop();
  state.count = 3;
  assert.equal(evaluations, 2);
  assert.equal(doubled.value, 6);
  assert.equal(evaluations, 3);
});

test('ref values participate in dependency tracking', () => {
  const count = ref(0);
  let observed = -1;
  effect(() => { observed = count.value; });
  assert.equal(observed, 0);
  count.value = 2;
  assert.equal(observed, 2);
});

test('shallowRef tracks replacement and triggerRef tracks manual deep mutation', () => {
  const state = shallowRef({ count: 0 });
  let observed = '';
  let runs = 0;
  effect(() => { runs++; observed = String(state.value.count); });
  state.value.count = 1;
  assert.equal(runs, 1);
  assert.equal(observed, '0');
  triggerRef(state);
  assert.equal(runs, 2);
  assert.equal(observed, '1');
  state.value = { count: 2 };
  assert.equal(runs, 3);
  assert.equal(observed, '2');
});

test('reactive Map and Set track keyed and iteration dependencies', () => {
  const values = reactive(new Map([['a', 1]]));
  const tags = reactive(new Set(['a']));
  let mapped = 0;
  let mapSize = 0;
  let hasTag = false;
  let tagSize = 0;
  effect(() => { mapped = values.get('a'); });
  effect(() => { mapSize = values.size; });
  effect(() => { hasTag = tags.has('a'); });
  effect(() => { tagSize = tags.size; });
  values.set('a', 2);
  values.set('b', 3);
  tags.delete('a');
  tags.add('b');
  assert.equal(mapped, 2);
  assert.equal(mapSize, 2);
  assert.equal(hasTag, false);
  assert.equal(tagSize, 1);
});

test('reactive collection iterators proxy nested values and forEach collections', () => {
  const map = reactive(new Map([['item', { label: 'A' }]]));
  const set = reactive(new Set([{ label: 'B' }]));
  let mapLabel = '';
  let setLabel = '';
  let iteratedMap;
  effect(() => { mapLabel = [...map.values()][0].label; });
  effect(() => { setLabel = [...set][0].label; });
  effect(() => { map.forEach((_value, _key, collection) => { iteratedMap = collection; }); });
  const mapValue = map.get('item');
  const setValue = [...set][0];
  mapValue.label = 'A2';
  setValue.label = 'B2';
  assert.equal(mapLabel, 'A2');
  assert.equal(setLabel, 'B2');
  assert.equal(iteratedMap, map);
  assert.deepEqual([...set.entries()][0], [setValue, setValue]);
});

test('watch tracks getters and reactive objects while running registered cleanup', () => {
  const state = reactive({ count: 0, nested: { enabled: false } });
  const changes = [];
  const stop = watch(() => state.count, (value, previous, onCleanup) => {
    changes.push([value, previous]);
    onCleanup(() => changes.push(['cleanup', value]));
  }, { immediate: true });
  state.count = 1;
  state.count = 2;
  stop();
  assert.deepEqual(changes, [[0, undefined], ['cleanup', 0], [1, 0], ['cleanup', 1], [2, 1], ['cleanup', 2]]);

  let nestedRuns = 0;
  const stopNested = watch(state, () => { nestedRuns++; });
  state.nested.enabled = true;
  assert.equal(nestedRuns, 1);
  stopNested();
});

test('post-flush watches batch updates behind nextTick', async () => {
  const state = reactive({ count: 0 });
  const values = [];
  watch(() => state.count, value => values.push(value), { flush: 'post' });
  state.count = 1;
  state.count = 2;
  assert.deepEqual(values, []);
  await nextTick();
  assert.deepEqual(values, [2]);
});

test('pre and post watchers observe the correct render boundary', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const events = [];
  const state = reactive({ count: 0 });
  watch(() => state.count, () => events.push(`pre:${root.textContent}`), { flush: 'pre' });
  watch(() => state.count, () => events.push(`post:${root.textContent}`), { flush: 'post' });
  createApp(() => h('span', {}, state.count), state).mount(root);
  state.count = 1;
  state.count = 2;
  assert.deepEqual(events, []);
  await nextTick();
  assert.deepEqual(events, ['pre:0', 'post:2']);
});

test('nextTick accepts a callback after queued jobs flush', async () => {
  const state = reactive({ count: 0 });
  const values = [];
  effect(() => state.count, { scheduler: () => values.push(state.count) });
  state.count = 1;
  const result = await nextTick(() => `${state.count}:done`);
  assert.deepEqual(values, [1]);
  assert.equal(result, '1:done');
});

test('watchEffect cleans up stale work and can be stopped', () => {
  const state = reactive({ count: 0 });
  const events = [];
  const stop = watchEffect(onCleanup => {
    events.push(`run:${state.count}`);
    onCleanup(() => events.push(`cleanup:${state.count}`));
  });
  state.count = 1;
  stop();
  state.count = 2;
  assert.deepEqual(events, ['run:0', 'cleanup:1', 'run:1', 'cleanup:1']);
});

test('async components render loading, resolved, and error states', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let resolve;
  const Async = defineAsyncComponent({
    loader: () => new Promise(done => { resolve = done; }),
    loadingComponent: () => h('p', {}, 'Loading'),
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  const app = createApp(() => h('section', {}, [h(Async)]));
  app.mount(root);
  assert.equal(root.textContent, 'Loading');
  resolve(() => h('strong', {}, 'Ready'));
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Ready');
  app.unmount();

  const Failed = defineAsyncComponent({
    loader: () => Promise.reject(new Error('offline')),
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  createApp(() => h(Failed)).mount(root);
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Error:offline');
});

test('proxyRefs unwraps genuine refs without confusing ordinary value properties', () => {
  const count = ref(1);
  const payload = { value: 'preserve me' };
  const state = proxyRefs({ count, label: 'Before', payload });
  assert.equal(isRef(count), true);
  assert.equal(isRef(payload), false);
  assert.equal(unref(count), 1);
  assert.equal(state.count, 1);
  assert.equal(state.payload, payload);
  state.count = 2;
  state.label = 'After';
  assert.equal(count.value, 2);
  assert.equal(state.label, 'After');
});

test('computed values participate in the ref contract', () => {
  const count = ref(2);
  const doubled = computed(() => count.value * 2);
  assert.equal(isRef(doubled), true);
  assert.equal(unref(doubled), 4);
  assert.equal(proxyRefs({ doubled }).doubled, 4);
  count.value = 3;
  assert.equal(doubled.value, 6);
});

test('toRef and toRefs retain reactive property links', () => {
  const state = reactive({ count: 1, label: 'Before', items: ['a'] });
  const count = toRef(state, 'count');
  const { label, items } = toRefs(state);
  let observed = '';
  effect(() => { observed = `${count.value}:${label.value}:${items.value.length}`; });
  count.value = 2;
  state.label = 'After';
  items.value.push('b');
  assert.equal(state.count, 2);
  assert.equal(label.value, 'After');
  assert.equal(observed, '2:After:2');
});

test('effect scopes stop nested effects and run registered cleanup', () => {
  const state = reactive({ count: 0 });
  const scope = effectScope();
  let runs = 0;
  let disposed = false;
  scope.run(() => {
    effect(() => { runs++; state.count; });
    onScopeDispose(() => { disposed = true; });
  });
  state.count++;
  assert.equal(runs, 2);
  scope.stop();
  state.count++;
  assert.equal(runs, 2);
  assert.equal(disposed, true);
});

test('effect scopes stop owned children while detached scopes survive', () => {
  const state = reactive({ count: 0 });
  const parent = effectScope();
  const child = parent.run(() => effectScope());
  const detached = parent.run(() => effectScope(true));
  let childRuns = 0;
  let detachedRuns = 0;
  child.run(() => effect(() => { childRuns++; state.count; }));
  detached.run(() => effect(() => { detachedRuns++; state.count; }));
  state.count++;
  assert.equal(childRuns, 2);
  assert.equal(detachedRuns, 2);
  parent.stop();
  state.count++;
  assert.equal(childRuns, 2);
  assert.equal(detachedRuns, 3);
  detached.stop();
  state.count++;
  assert.equal(detachedRuns, 3);
});

test('HMR polling replays every missed version in order', async () => {
  installDom();
  globalThis.EventSource = undefined;
  let phase = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => phase === 0
      ? { version: 1, historyComplete: true, changes: [{ path: 'initial.html', kind: 'MODIFY', version: 1 }] }
      : {
          version: 3,
          historyComplete: true,
          changes: [
            { path: 'profile.html', kind: 'MODIFY', version: 2 },
            { path: 'counter.html', kind: 'MODIFY', version: 3 }
          ]
        }
  });
  const versions = [];
  window.addEventListener('thymeleaf-reactive:template-change', event => versions.push(event.detail.version));
  const close = connectComponentHmr('/events', '/status', 5);
  await new Promise(resolve => setTimeout(resolve, 15));
  phase = 1;
  await new Promise(resolve => setTimeout(resolve, 35));
  close();
  assert.deepEqual(versions, [2, 3]);
});

test('closing HMR ignores an in-flight polling response', async () => {
  installDom();
  globalThis.EventSource = undefined;
  let resolveResponse;
  globalThis.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  const versions = [];
  window.addEventListener('thymeleaf-reactive:template-change', event => versions.push(event.detail.version));
  const close = connectComponentHmr('/events', '/status', 1000);
  close();
  resolveResponse({
    ok: true,
    json: async () => ({
      version: 2,
      historyComplete: true,
      changes: [{ path: 'profile.html', kind: 'MODIFY', version: 2 }]
    })
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(versions, []);
});

test('reactive effects clean stale branches and track array length changes', () => {
  const state = reactive({ enabled: true, first: 'A', second: 'B', items: ['x'] });
  let value = '';
  let runs = 0;
  effect(() => {
    runs++;
    value = state.enabled ? state.first : state.second;
  });
  state.enabled = false;
  assert.equal(value, 'B');
  const branchRuns = runs;
  state.first = 'ignored';
  assert.equal(runs, branchRuns);
  state.second = 'C';
  assert.equal(value, 'C');

  let length = 0;
  effect(() => { length = state.items.length; });
  state.items.push('y');
  assert.equal(length, 2);
  state.items.pop();
  assert.equal(length, 1);
});

test('effects can be stopped and apps can be unmounted cleanly', () => {
  const document = installDom();
  const state = reactive({ count: 0 });
  let runs = 0;
  const runner = effect(() => { runs++; state.count; });
  state.count++;
  assert.equal(runs, 2);
  runner.stop();
  state.count++;
  assert.equal(runs, 2);

  const root = document.createElement('main');
  const app = createApp(current => h('span', {}, String(current.count)), state);
  app.mount(root);
  assert.equal(root.textContent, '2');
  app.unmount();
  assert.equal(root.textContent, '');
  state.count++;
  assert.equal(root.textContent, '');
});

test('component HMR patches only mounted named component instances and cleans up on unmount', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Badge = defineComponent('badge-hmr-test', () => h('strong', { class: 'badge' }, 'Before'));
  const app = createApp(() => h('section', {}, [h('p', {}, 'Outside'), h(Badge)]));
  app.mount(root);
  const outside = root.querySelector('p');
  const badge = root.querySelector('strong');
  assert.equal(hotUpdate('badge-hmr-test', () => h('strong', { class: 'badge updated' }, 'After')), true);
  assert.equal(root.querySelector('p'), outside);
  assert.equal(root.querySelector('strong'), badge);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('strong').className, 'badge updated');
  app.unmount();
  hotUpdate('badge-hmr-test', () => h('strong', {}, 'Ignored'));
  assert.equal(root.textContent, '');
});

test('component HMR accepts object component replacements without refreshing the host tree', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = defineComponent('object-hmr-test', { render: () => h('strong', { class: 'before' }, 'Before') });
  const app = createApp(() => h('section', {}, [h('p', {}, 'Host'), h(Panel)]));
  app.mount(root);
  const host = root.querySelector('p');
  assert.equal(hotUpdate('object-hmr-test', { render: () => h('strong', { class: 'after' }, 'After') }), true);
  assert.equal(root.querySelector('p'), host);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('strong').className, 'after');
  app.unmount();
});

test('component HMR preserves script setup local refs while replacing its template', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const initial = compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `);
  const Counter = defineComponent('script-setup-hmr-state-test', initial);
  const app = createApp(() => h('section', {}, [h(Counter)]));
  app.mount(root);
  const button = root.querySelector('button');
  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');

  const replacement = compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `);
  assert.equal(hotUpdate('script-setup-hmr-state-test', replacement), true);
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
  app.unmount();
});

test('component HMR recreates script setup state when its script changes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('script-setup-hmr-script-change-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.textContent, 'Count: 2');

  assert.equal(hotUpdate('script-setup-hmr-script-change-test', compileSfcComponent(`
    <template><button @click="increment">Changed count: {{ count }}</button></template>
    <script setup>
      const count = ref(10);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(root.textContent, 'Changed count: 10');
  app.unmount();
});

test('adopted script setup components preserve local refs across HMR', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><button>Server</button></section>';
  const root = document.querySelector('section');
  const Counter = defineComponent('adopted-script-setup-hmr-state-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  adoptComponentRoot(root, Counter);
  const button = document.querySelector('button');
  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');

  assert.equal(hotUpdate('adopted-script-setup-hmr-state-test', compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(document.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
});

test('fragment components patch and hot-update multiple root nodes as one range', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Pair = defineComponent('fragment-hmr-test', () => h(Fragment, {}, [
    h('strong', { key: 'title' }, 'Before'),
    h('em', { key: 'detail' }, 'Detail')
  ]));
  const app = createApp(() => h('section', {}, [h(Pair), h('p', { key: 'outside' }, 'Outside')]));
  app.mount(root);
  const outside = root.querySelector('p');
  const title = root.querySelector('strong');
  assert.equal(hotUpdate('fragment-hmr-test', () => h(Fragment, {}, [
    h('strong', { key: 'title' }, 'After'),
    h('code', { key: 'detail' }, 'Replacement detail')
  ])), true);
  assert.equal(root.querySelector('strong'), title);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('code').textContent, 'Replacement detail');
  assert.equal(root.querySelector('p'), outside);
  app.unmount();
  assert.equal(root.textContent, '');
});

test('keyed fragment children move their full DOM ranges together', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(state => h('ul', {}, state.items.map(item => h(Fragment, { key: item.id }, [
    h('li', { key: 'label' }, item.label),
    h('li', { key: 'meta' }, item.meta)
  ]))), { items: [{ id: 'a', label: 'A', meta: 'A*' }, { id: 'b', label: 'B', meta: 'B*' }] });
  const state = app.mount(root);
  const initial = root.querySelectorAll('li');
  const firstB = initial[2];
  const secondB = initial[3];
  state.items = [{ id: 'b', label: 'B2', meta: 'B2*' }, { id: 'a', label: 'A', meta: 'A*' }];
  await nextTick();
  const rows = root.querySelectorAll('li');
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], secondB);
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'B2*', 'A', 'A*']);
});

test('component HMR patches server output while preserving field state', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><input data-tr-key="draft" value="server"><strong data-tr-key="label">Before</strong></section>';
  const input = document.querySelector('input');
  input.value = 'typing';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="counter"><input data-tr-key="draft" value="new-server"><strong data-tr-key="label">After</strong></section></body></html>'
  });
  await refreshComponentsFromPage('counter');
  assert.equal(document.querySelector('strong').textContent, 'After');
  assert.equal(document.querySelector('input'), input);
  assert.equal(document.querySelector('input').value, 'typing');
});

test('component HMR reconciles keyed component instances across reorders, additions, and removals', async () => {
  const document = installDom();
  document.body.innerHTML = [
    '<div id="components">',
    '<section data-tr-component="row" data-tr-key="a" data-tr-state="{&quot;label&quot;:&quot;A&quot;}"><input data-tr-model="label"><strong data-tr-text="label"></strong></section>',
    '<section data-tr-component="row" data-tr-key="b" data-tr-state="{&quot;label&quot;:&quot;B&quot;}"><input data-tr-model="label"><strong data-tr-text="label"></strong></section>',
    '</div>'
  ].join('');
  const oldA = document.querySelector('[data-tr-key="a"]');
  const oldB = document.querySelector('[data-tr-key="b"]');
  hydrate(oldA, { label: 'A' });
  hydrate(oldB, { label: 'B' });
  oldB.querySelector('input').value = 'Typing B';
  oldB.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => [
      '<html><body><div id="components">',
      '<section data-tr-component="row" data-tr-key="b" data-tr-state="{&quot;label&quot;:&quot;B server&quot;}"><input data-tr-model="label"><strong data-tr-text="label">stale</strong></section>',
      '<section data-tr-component="row" data-tr-key="c" data-tr-state="{&quot;label&quot;:&quot;C&quot;}"><input data-tr-model="label"><strong data-tr-text="label">stale</strong></section>',
      '</div></body></html>'
    ].join('')
  });
  await refreshComponentsFromPage('row');
  const rows = document.querySelectorAll('[data-tr-component="row"]');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], oldB);
  assert.equal(document.querySelector('[data-tr-key="a"]'), null);
  assert.equal(rows[0].querySelector('input').value, 'Typing B');
  assert.equal(rows[0].querySelector('strong').textContent, 'Typing B');
  assert.equal(rows[1].dataset.trKey, 'c');
  assert.equal(rows[1].querySelector('strong').textContent, 'C');
  rows[1].querySelector('input').value = 'C updated';
  rows[1].querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(rows[1].querySelector('strong').textContent, 'C updated');
});

test('component HMR inserts a first component instance into a structural parent match', async () => {
  const document = installDom();
  document.body.innerHTML = '<main><section class="slot"></section></main>';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><main><section class="slot"><article data-tr-component="alert" data-tr-state="{&quot;message&quot;:&quot;Ready&quot;}"><strong data-tr-text="message">stale</strong></article></section></main></body></html>'
  });
  await refreshComponentsFromPage('alert');
  assert.equal(document.querySelector('[data-tr-component="alert"] strong').textContent, 'Ready');
});

test('component HMR hydrates reactive bindings introduced by a changed template', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="profile" data-tr-state="{&quot;name&quot;:&quot;Ada&quot;}"><strong>Before</strong></section>';
  const state = hydrate(document.querySelector('section'), { name: 'Ada' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="profile"><strong data-tr-text="name">stale</strong></section></body></html>'
  });
  await refreshComponentsFromPage('profile');
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.name = 'Grace';
  await nextTick();
  assert.equal(document.querySelector('strong').textContent, 'Grace');
});

test('component HMR disposes bindings replaced by a template change', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="profile"><strong data-tr-text="count">1</strong></section>';
  const state = hydrate(document.querySelector('section'), { count: 1, message: 'Ada' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="profile"><strong data-tr-text="message">stale</strong></section></body></html>'
  });
  await refreshComponentsFromPage('profile');
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.count = 2;
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.message = 'Grace';
  await nextTick();
  assert.equal(document.querySelector('strong').textContent, 'Grace');
});

test('component hydration does not bind descendants owned by nested components', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="outer"><p data-tr-text="label"></p><section data-tr-component="inner"><p data-tr-text="label"></p></section></section>';
  const outerRoot = document.querySelector('[data-tr-component="outer"]');
  const innerRoot = document.querySelector('[data-tr-component="inner"]');
  const outer = hydrate(outerRoot, { label: 'Outer' });
  const inner = hydrate(innerRoot, { label: 'Inner' });
  const labels = document.querySelectorAll('p');
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer', 'Inner']);
  outer.label = 'Outer updated';
  await nextTick();
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer updated', 'Inner']);
  inner.label = 'Inner updated';
  await nextTick();
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer updated', 'Inner updated']);
});

test('component HMR patches server conditional comment anchors', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><!--tr-if--><p data-tr-if="visible">Before</p></section>';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="counter"><!--tr-if--><p data-tr-if="visible">After</p></section></body></html>'
  });
  await refreshComponentsFromPage('counter');
  assert.equal(document.querySelector('p').textContent, 'After');
  assert.equal(document.querySelector('section').firstChild.nodeType, Node.COMMENT_NODE);
});

test('virtual DOM patches changed content without replacing keyed input nodes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(state => h('section', {}, [
    h('input', { key: 'draft', value: state.draft }),
    h('strong', { key: 'count' }, String(state.count))
  ]), { draft: 'kept', count: 0 });
  const state = app.mount(root);
  const input = root.querySelector('input');
  state.count = 1;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '1');
  assert.equal(root.querySelector('input'), input);
  assert.equal(root.querySelector('input').value, 'kept');
});

test('render retains the previous tree and supports explicit unmounting', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('section', {}, [h('input', { key: 'draft', value: 'kept' }), h('strong', {}, 'Before')]), root);
  const input = root.querySelector('input');
  render(h('section', {}, [h('input', { key: 'draft', value: 'kept' }), h('strong', {}, 'After')]), root);
  assert.equal(root.querySelector('input'), input);
  assert.equal(root.textContent, 'After');
  render(null, root);
  assert.equal(root.childNodes.length, 0);
});

test('hydrateRender adopts compatible SSR nodes and recovers structural mismatches', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<section class="server"><span>stale</span><i>remove me</i></section>';
  const section = root.firstElementChild;
  const span = section.firstElementChild;
  const tree = hydrateRender(h('section', { class: 'client' }, [h('span', {}, 'ready'), h('strong', {}, 'added')]), root);
  assert.equal(tree.el, section);
  assert.equal(section.className, 'client');
  assert.equal(section.firstElementChild, span);
  assert.equal(section.textContent, 'readyadded');
  assert.equal(section.querySelector('i'), null);
  const next = render(h('section', { class: 'updated' }, [h('span', {}, 'done')]), root);
  assert.equal(next.el, section);
  assert.equal(section.className, 'updated');
  assert.equal(section.textContent, 'done');
});

test('hydrateRender adopts multi-root SSR fragments as one patchable range', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<span>one</span><p>stale</p><i>remove me</i>';
  const first = root.firstElementChild;
  const tree = hydrateRender(h(Fragment, {}, [
    h('span', { key: 'one' }, 'updated'),
    h('strong', { key: 'two' }, 'two')
  ]), root);
  assert.equal(tree.el.nodeType, Node.COMMENT_NODE);
  assert.equal(tree.anchor.nodeType, Node.COMMENT_NODE);
  assert.equal(root.firstElementChild, first);
  assert.deepEqual([...root.children].map(element => element.textContent), ['updated', 'two']);
  const next = render(h(Fragment, {}, [
    h('strong', { key: 'two' }, 'changed'),
    h('span', { key: 'one' }, 'moved')
  ]), root);
  assert.equal(next.el, tree.el);
  assert.deepEqual([...root.children].map(element => element.textContent), ['changed', 'moved']);
});

test('hydrateRender creates component instances on top of SSR roots', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button class="server">stale</button>';
  const button = root.firstElementChild;
  const hooks = [];
  const Counter = {
    props: ['label'],
    setup(props) {
      const count = ref(0);
      onMounted(() => hooks.push('mounted'));
      return () => h('button', {
        class: 'client',
        onClick: () => count.value++
      }, `${props.label}:${count.value}`);
    }
  };
  const tree = hydrateRender(h(Counter, { label: 'Count' }), root);
  assert.equal(tree.instance !== undefined, true);
  assert.equal(root.firstElementChild, button);
  assert.equal(button.className, 'client');
  assert.equal(button.textContent, 'Count:0');
  assert.deepEqual(hooks, ['mounted']);
  button.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.firstElementChild, button);
  assert.equal(button.textContent, 'Count:1');
});

test('hydrateRender registers named component instances for state-preserving HMR', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button>Server</button>';
  const Counter = defineComponent('hydrated-component-hmr-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  hydrateRender(h(Counter), root);
  const button = root.querySelector('button');
  button.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');
  assert.equal(hotUpdate('hydrated-component-hmr-test', compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
});

test('VNode children normalize nested arrays as Fragment ranges', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('div', {}, [
    h('span', {}, 'one'),
    [h('strong', {}, 'two'), h('em', {}, 'three')]
  ]), root);
  assert.equal(root.textContent, 'onetwothree');
  assert.equal(root.querySelectorAll('div > span').length, 1);
  assert.equal(root.querySelectorAll('div > strong').length, 1);
  assert.equal(root.querySelectorAll('div > em').length, 1);
});

test('Teleport patches and moves its child range without recreating keyed fields', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const firstTarget = document.createElement('aside');
  const secondTarget = document.createElement('aside');
  firstTarget.id = 'first-target';
  secondTarget.id = 'second-target';
  document.body.append(firstTarget, secondTarget);
  const app = createApp(state => h('section', {}, [
    h('p', {}, 'Host'),
    state.visible && h(Teleport, { to: state.target }, [
      h('input', { key: 'draft', value: state.draft }),
      h('strong', { key: 'label' }, state.label)
    ])
  ]), { visible: true, target: '#first-target', draft: 'Initial', label: 'Before' });
  const state = app.mount(root);
  const input = firstTarget.querySelector('input');
  assert.equal(root.textContent, 'Host');
  assert.equal(firstTarget.querySelector('strong').textContent, 'Before');

  state.label = 'After';
  await nextTick();
  assert.equal(firstTarget.querySelector('input'), input);
  assert.equal(firstTarget.querySelector('strong').textContent, 'After');

  state.target = '#second-target';
  await nextTick();
  assert.equal(firstTarget.querySelector('input'), null);
  assert.equal(secondTarget.querySelector('input'), input);
  assert.equal(secondTarget.querySelector('strong').textContent, 'After');

  state.visible = false;
  await nextTick();
  assert.equal(secondTarget.childNodes.length, 0);
  app.unmount();
});

test('KeepAlive caches keyed component instances across switches', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const hooks = [];
  const Counter = {
    setup(props) {
      const count = ref(0);
      onMounted(() => hooks.push(`mounted:${props.name}`));
      onActivated(() => hooks.push(`activated:${props.name}`));
      onDeactivated(() => hooks.push(`deactivated:${props.name}`));
      onUnmounted(() => hooks.push(`unmounted:${props.name}`));
      return () => h('button', { onClick: () => count.value++ }, `${props.name}:${count.value}`);
    }
  };
  const app = createApp(state => h(KeepAlive, {}, [
    h(Counter, { key: state.name, name: state.name })
  ]), { name: 'A' });
  const state = app.mount(root);
  const firstA = root.querySelector('button');
  firstA.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(firstA.textContent, 'A:1');
  state.name = 'B';
  await nextTick();
  const buttonB = root.querySelector('button');
  assert.equal(buttonB.textContent, 'B:0');
  state.name = 'A';
  await nextTick();
  assert.equal(root.querySelector('button'), firstA);
  assert.equal(firstA.textContent, 'A:1');
  assert.deepEqual(hooks, ['mounted:A', 'activated:A', 'deactivated:A', 'mounted:B', 'activated:B', 'deactivated:B', 'activated:A']);
  state.name = 'B';
  await nextTick();
  assert.equal(root.querySelector('button'), buttonB);
  app.unmount();
  assert.equal(hooks.includes('unmounted:A'), true);
  assert.equal(hooks.includes('unmounted:B'), true);
});

test('KeepAlive max evicts the least recently activated instance', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = {
    setup(props) {
      const count = ref(0);
      return () => h('button', { onClick: () => count.value++ }, `${props.name}:${count.value}`);
    }
  };
  const app = createApp(state => h(KeepAlive, { max: 1 }, [
    h(Counter, { key: state.view, name: state.view })
  ]), { view: 'A' });
  const state = app.mount(root);
  const firstA = root.querySelector('button');
  firstA.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(firstA.textContent, 'A:1');
  state.view = 'B';
  await nextTick();
  state.view = 'A';
  await nextTick();
  const secondA = root.querySelector('button');
  assert.notEqual(secondA, firstA);
  assert.equal(secondA.textContent, 'A:0');
  app.unmount();
});

test('component updates are deduplicated and committed on nextTick', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let renders = 0;
  const Counter = {
    setup(props) {
      return () => {
        renders++;
        return h('strong', {}, String(props.count));
      };
    }
  };
  const app = createApp(state => h(Counter, { count: state.count }), { count: 0 });
  const state = app.mount(root);
  assert.equal(root.textContent, '0');
  assert.equal(renders, 1);
  state.count = 1;
  state.count = 2;
  assert.equal(root.textContent, '0');
  await nextTick();
  assert.equal(root.textContent, '2');
  assert.equal(renders, 2);
  app.unmount();
});

test('component scheduler updates parents before children', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const updates = [];
  const Child = {
    setup(props) {
      onBeforeUpdate(() => updates.push('child'));
      return () => h('span', {}, String(props.value));
    }
  };
  const Parent = {
    setup(props) {
      onBeforeUpdate(() => updates.push('parent'));
      return () => h('div', {}, [h(Child, { value: props.child })]);
    }
  };
  const app = createApp(state => h(Parent, { parent: state.parent, child: state.child }), { parent: 0, child: 0 });
  const state = app.mount(root);
  state.parent = 1;
  state.child = 1;
  await nextTick();
  assert.deepEqual(updates, ['parent', 'child']);
  assert.equal(root.textContent, '1');
  app.unmount();
});

test('scheduler isolates a failed component job and continues flushing', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let childUpdates = 0;
  const Child = {
    setup(props) {
      onUpdated(() => childUpdates++);
      return () => h('span', {}, String(props.value));
    }
  };
  const Parent = {
    setup(props) {
      onUpdated(() => { throw new Error('parent update failed'); });
      return () => h('div', {}, [h(Child, { value: props.value })]);
    }
  };
  const app = createApp(state => h(Parent, { value: state.value }), { value: 0 });
  const state = app.mount(root);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    state.value = 1;
    await nextTick();
  } finally {
    console.error = originalError;
  }
  assert.equal(root.textContent, '1');
  assert.equal(childUpdates, 1);
  assert.equal(errors.length, 1);
  app.unmount();
});

test('object components retain setup state and support lifecycle, emits, and injection', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const hooks = [];
  const emitted = [];
  const Child = {
    setup(props, { emit }) {
      const prefix = inject('prefix');
      const clicks = ref(0);
      onBeforeMount(() => hooks.push('child-before-mount'));
      onMounted(() => hooks.push('child-mounted'));
      onBeforeUpdate(() => hooks.push('child-before-update'));
      onUpdated(() => hooks.push('child-updated'));
      onBeforeUnmount(() => hooks.push('child-before-unmount'));
      onUnmounted(() => hooks.push('child-unmounted'));
      return () => h('button', {
        onClick: () => {
          clicks.value++;
          emit('save', clicks.value);
        }
      }, `${prefix}:${props.label}:${clicks.value}`);
    }
  };
  const Parent = {
    setup(props) {
      provide('prefix', 'injected');
      onMounted(() => hooks.push('parent-mounted'));
      onUpdated(() => hooks.push('parent-updated'));
      onUnmounted(() => hooks.push('parent-unmounted'));
      return () => h('section', {}, [h(Child, { label: props.label, onSave: value => emitted.push(value) })]);
    }
  };
  const app = createApp(state => h(Parent, { label: state.label }), { label: 'Before' });
  const state = app.mount(root);
  const button = root.querySelector('button');
  assert.equal(button.textContent, 'injected:Before:0');
  assert.deepEqual(hooks, ['child-before-mount', 'child-mounted', 'parent-mounted']);

  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'injected:Before:1');
  assert.deepEqual(emitted, [1]);
  assert.equal(hooks.includes('child-before-update'), true);
  assert.equal(hooks.includes('child-updated'), true);

  state.label = 'After';
  await nextTick();
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'injected:After:1');
  assert.equal(hooks.includes('parent-updated'), true);

  app.unmount();
  assert.equal(root.childNodes.length, 0);
  assert.ok(hooks.indexOf('child-before-unmount') < hooks.indexOf('child-unmounted'));
  assert.equal(hooks.includes('child-unmounted'), true);
  assert.equal(hooks.includes('parent-unmounted'), true);
});

test('object components separate declared props, attrs, and emits', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const emitted = [];
  const Child = {
    props: ['label'],
    emits: ['save'],
    setup(props, { attrs, emit }) {
      return () => h('button', {
        ...attrs,
        onClick: () => emit('save', props.label)
      }, props.label);
    }
  };
  const app = createApp(() => h(Child, {
    label: 'Ready',
    id: 'child',
    title: 'Child',
    onSave: value => emitted.push(value)
  }));
  app.mount(root);
  const button = root.querySelector('button');
  assert.equal(button.textContent, 'Ready');
  assert.equal(button.id, 'child');
  assert.equal(button.title, 'Child');
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(emitted, ['Ready']);
  app.unmount();

  const NoFallthrough = {
    props: ['label'],
    inheritAttrs: false,
    setup(props, { attrs }) {
      return () => h('span', {}, `${props.label}:${Object.keys(attrs).length}`);
    }
  };
  render(h(NoFallthrough, { label: 'Hidden', id: 'ignored' }), root);
  assert.equal(root.querySelector('span').id, '');
  assert.equal(root.textContent, 'Hidden:1');
});

test('object component setup exposes reactive default and named slots', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = {
    setup(_props, { slots }) {
      return () => h('article', {}, [
        h('header', {}, slots.header?.() ?? []),
        h('main', {}, slots.default?.() ?? [])
      ]);
    }
  };
  const render = state => h(Panel, {}, [
    h('h1', { slot: 'header' }, state.title),
    h('p', {}, state.body)
  ]);
  const state = createApp(render, { title: 'Title', body: 'Body' }).mount(root);
  const heading = root.querySelector('h1');
  const paragraph = root.querySelector('p');
  assert.equal(heading.textContent, 'Title');
  assert.equal(paragraph.textContent, 'Body');
  state.title = 'Updated title';
  state.body = 'Updated body';
  await nextTick();
  assert.equal(root.querySelector('h1'), heading);
  assert.equal(root.querySelector('p'), paragraph);
  assert.equal(heading.textContent, 'Updated title');
  assert.equal(paragraph.textContent, 'Updated body');
});

test('object component slots expose names added after setup', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = {
    setup(_props, { slots }) {
      return () => {
        const extra = slots.extra?.() ?? [];
        return h('article', {}, extra.length ? extra : [h('em', {}, 'No extra')]);
      };
    }
  };
  const render = state => h(Panel, {}, state.extra
    ? [h('strong', { slot: 'extra' }, state.extra)]
    : []);
  const state = createApp(render, { extra: '' }).mount(root);
  assert.equal(root.querySelector('em').textContent, 'No extra');
  state.extra = 'Added';
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Added');
  state.extra = '';
  await nextTick();
  assert.equal(root.querySelector('em').textContent, 'No extra');
});

test('virtual DOM performs keyed moves and insertions while updating props and listeners', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let clicks = 0;
  const first = createApp(state => h('ul', { class: state.active ? 'active' : 'idle', style: { color: state.color } }, [
    ...state.items.map(item => h('li', { key: item.id, onClick: () => clicks++ }, item.label))
  ]), { active: false, color: 'red', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  const state = first.mount(root);
  const originalA = root.querySelectorAll('li')[0];
  const originalB = root.querySelectorAll('li')[1];

  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  state.active = true;
  state.color = 'blue';
  await nextTick();

  const items = root.querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.equal(items[0], originalB);
  assert.equal(items[1], originalA);
  assert.equal(items[0].textContent, 'B2');
  assert.equal(root.querySelector('ul').className, 'active');
  assert.equal(root.querySelector('ul').style.color, 'blue');
  items[0].dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(clicks, 1);
});

test('virtual DOM creates SVG trees in the SVG namespace', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = createApp(state => h('svg', { viewBox: state.viewBox }, [
    h('g', {}, [h('circle', { cx: 4, cy: 5, r: state.radius })])
  ]), { viewBox: '0 0 10 10', radius: 2 }).mount(root);
  const svg = root.querySelector('svg');
  const circle = root.querySelector('circle');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(circle.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(circle.getAttribute('r'), '2');
  state.radius = 3;
  state.viewBox = '0 0 20 20';
  await nextTick();
  assert.equal(root.querySelector('circle'), circle);
  assert.equal(circle.getAttribute('r'), '3');
  assert.equal(svg.getAttribute('viewBox'), '0 0 20 20');
});

test('virtual DOM removes stale event listeners and style properties', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let oldClicks = 0;
  let newClicks = 0;
  const app = createApp(state => h('button', {
    onClick: state.version === 0 ? () => oldClicks++ : () => newClicks++,
    style: state.version === 0 ? { color: 'red', background: 'white' } : { color: 'green' }
  }, 'go'), { version: 0 });
  const state = app.mount(root);
  const button = root.querySelector('button');
  state.version = 1;
  await nextTick();
  button.dispatchEvent(new Event('click'));
  assert.equal(oldClicks, 0);
  assert.equal(newClicks, 1);
  assert.equal(button.style.color, 'green');
  assert.equal(button.style.background, '');
});

test('runtime-dom normalizes class and style values and invokes event arrays', () => {
  const document = installDom();
  const root = document.createElement('main');
  let calls = 0;
  const first = h('button', {
    class: ['base', { active: true }, ['nested']],
    style: [{ color: 'red' }, 'display: block;'],
    onClick: [() => calls++, () => calls += 2]
  }, 'Run');
  render(first, root);
  const button = root.querySelector('button');
  assert.equal(button.className, 'base active nested');
  assert.equal(button.style.color, 'red');
  assert.equal(button.style.display, 'block');
  button.dispatchEvent(new Event('click'));
  assert.equal(calls, 3);
  render(h('button', { class: { active: false, next: true }, style: 'color: blue;' }, 'Run'), root);
  assert.equal(button.className, 'next');
  assert.equal(button.style.color, 'blue');
  assert.equal(button.style.display, '');
});

test('SFC render tracks state, loops keyed children, and writes v-model values back', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <section>
        <strong>{{count}}</strong>
        <button v-if="visible" @click="increment()">inc</button>
        <em v-else>hidden</em>
        <ul><li v-for="item in items" :key="item.id">{{item.label}}</li></ul>
        <input v-model="name">
      </section>
    </template>
  `);
  const state = createApp(render, {
    count: 0,
    visible: true,
    name: 'Ada',
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    increment() { this.count++; }
  }).mount(root);
  assert.equal(root.querySelector('strong').textContent, '0');
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '1');
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('em').textContent, 'hidden');
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['B2', 'A']);
  const input = root.querySelector('input');
  input.value = 'Grace';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.name, 'Grace');
});

test('SFC v-once caches static subtrees while dynamic siblings continue updating', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('sfc-v-once-test', compileSfcComponent(`
    <template><section><strong v-once>{{ label }}</strong><span>{{ count }}</span><button @click="increment">go</button></section></template>
    <script setup>
      const label = ref('Initial');
      const count = ref(0);
      function increment() { count.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  const span = root.querySelector('span');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, 'Initial');
  assert.equal(root.querySelector('span'), span);
  assert.equal(span.textContent, '1');
  app.unmount();

  const hmrRoot = document.createElement('main');
  const Hmr = defineComponent('sfc-v-once-hmr-test', compileSfcComponent('<template><strong v-once>Before</strong></template>'));
  const hmrApp = createApp(() => h(Hmr));
  hmrApp.mount(hmrRoot);
  assert.equal(hotUpdate('sfc-v-once-hmr-test', compileSfcComponent('<template><strong v-once>After</strong></template>')), true);
  assert.equal(hmrRoot.textContent, 'After');
  hmrApp.unmount();
});

test('SFC v-memo skips a subtree until its dependency array changes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('sfc-v-memo-test', compileSfcComponent(`
    <template><section><strong v-memo="[version]">{{ count }}</strong><button @click="increment">go</button><button @click="refresh">refresh</button></section></template>
    <script setup>
      const count = ref(0);
      const version = ref(0);
      function increment() { count.value++; }
      function refresh() { version.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  const [increment, refresh] = root.querySelectorAll('button');
  increment.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, '0');
  refresh.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, '1');
  app.unmount();
});

test('withMemo reuses VNodes by dependency identity', () => {
  const cache = [];
  let renders = 0;
  const renderMemo = value => withMemo([value], () => {
    renders++;
    return h('strong', {}, String(value));
  }, cache, 0);
  const first = renderMemo(1);
  const second = renderMemo(1);
  const third = renderMemo(2);
  assert.equal(first, second);
  assert.notEqual(second, third);
  assert.equal(renders, 2);
  assert.equal(isMemoSame(third, [2]), true);
  assert.equal(isMemoSame(third, [1]), false);
});

test('SFC hoists static subtrees and invalidates them during template HMR', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const script = `
      const count = ref(0);
      function increment() { count.value++; }
    `;
  const Counter = defineComponent('sfc-static-hoist-test', compileSfcComponent(`<template><section><strong>Before</strong><span>{{ count }}</span><button @click="increment">go</button></section></template><script setup>${script}</script>`));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(root.querySelector('span').textContent, '1');
  assert.equal(hotUpdate('sfc-static-hoist-test', compileSfcComponent(`<template><section><strong>After</strong><span>{{ count }}</span><button @click="increment">go</button></section></template><script setup>${script}</script>`)), true);
  assert.equal(root.querySelector('strong').textContent, 'After');
  app.unmount();
});

test('SFC v-model handles checkbox and radio values and event arguments', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input type="checkbox" v-model="enabled">
        <input type="radio" value="a" v-model="choice">
        <input type="radio" value="b" v-model="choice">
        <button @click="choose('done')">choose</button>
      </div>
    </template>
  `);
  const state = createApp(render, {
    enabled: false,
    choice: 'a',
    result: '',
    choose(value) { this.result = value; }
  }).mount(root);
  const [checkbox, radioA, radioB, button] = root.querySelectorAll('input,button');
  assert.equal(checkbox.checked, false);
  assert.equal(radioA.checked, true);
  assert.equal(radioB.checked, false);
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  radioB.checked = true;
  radioB.dispatchEvent(new Event('change', { bubbles: true }));
  button.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.enabled, true);
  assert.equal(state.choice, 'b');
  assert.equal(state.result, 'done');
});

test('SFC v-model modifiers trim, coerce numbers, and defer lazy updates', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input v-model.trim.number="amount">
        <input v-model.lazy="draft">
        <select v-model.number="choice"><option value="1">One</option><option value="2">Two</option></select>
      </div>
    </template>
  `);
  const state = createApp(render, { amount: 0, draft: 'old', choice: 1 }).mount(root);
  const [amount, draft] = root.querySelectorAll('input');
  const select = root.querySelector('select');
  amount.value = ' 42 ';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.amount, 42);
  draft.value = 'new';
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.draft, 'old');
  draft.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.draft, 'new');
  select.value = '2';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.choice, 2);
});

test('SFC event handlers accept literal and $event arguments', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><div><button @click="setValue(7)">literal</button><button @click="setEvent($event)">event</button></div></template>');
  const state = createApp(render, {
    value: 0,
    event: null,
    setValue(value) { this.value = value; },
    setEvent(value) { this.event = value; }
  }).mount(root);
  const [literal, eventButton] = root.querySelectorAll('button');
  literal.dispatchEvent(new Event('click', { bubbles: true }));
  const event = new Event('click', { bubbles: true });
  eventButton.dispatchEvent(event);
  assert.equal(state.value, 7);
  assert.equal(state.event, event);
});

test('SFC event modifiers prevent, stop, filter, and limit handlers', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div @click="parent" @click.self="self">
        <button @click.prevent.stop="child">Child</button>
        <button v-on:click.once="once">Once</button>
      </div>
    </template>
  `);
  const state = createApp(render, {
    parentRuns: 0, selfRuns: 0, childRuns: 0, onceRuns: 0,
    parent() { this.parentRuns++; },
    self() { this.selfRuns++; },
    child() { this.childRuns++; },
    once() { this.onceRuns++; }
  }).mount(root);
  const [child, once] = root.querySelectorAll('button');
  const childEvent = new Event('click', { bubbles: true, cancelable: true });
  child.dispatchEvent(childEvent);
  assert.equal(childEvent.defaultPrevented, true);
  assert.equal(state.childRuns, 1);
  assert.equal(state.parentRuns, 0);
  assert.equal(state.selfRuns, 0);
  once.dispatchEvent(new Event('click', { bubbles: true }));
  once.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.onceRuns, 1);
});

test('SFC event modifiers filter keyboard, mouse, and system inputs', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input @keyup.enter="enter" @keyup.ctrl.exact="ctrl">
        <button @click.right="right">Right</button>
      </div>
    </template>
  `);
  const state = createApp(render, { enterRuns: 0, ctrlRuns: 0, rightRuns: 0,
    enter() { this.enterRuns++; }, ctrl() { this.ctrlRuns++; }, right() { this.rightRuns++; } }).mount(root);
  const input = root.querySelector('input');
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert.equal(state.enterRuns, 3);
  assert.equal(state.ctrlRuns, 1);
  const button = root.querySelector('button');
  button.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }));
  button.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true }));
  assert.equal(state.rightRuns, 1);
});

test('SFC resolves dynamic attribute and event arguments', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><button :[attribute]="value" v-on:[eventName]="handle">Dynamic</button></template>');
  const state = createApp(render, {
    attribute: 'title', value: 'First', eventName: 'click', runs: 0,
    handle() { this.runs++; }
  }).mount(root);
  const button = root.querySelector('button');
  assert.equal(button.title, 'First');
  button.dispatchEvent(new Event('click'));
  assert.equal(state.runs, 1);
  state.attribute = 'aria-label';
  state.value = 'Second';
  state.eventName = 'dblclick';
  await nextTick();
  assert.equal(button.getAttribute('aria-label'), 'Second');
  button.dispatchEvent(new Event('click'));
  button.dispatchEvent(new Event('dblclick'));
  assert.equal(state.runs, 2);
});

test('SFC v-model supports checkbox arrays and select values', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input type="checkbox" value="a" v-model="tags">
        <input type="checkbox" value="b" v-model="tags">
        <select v-model="choice"><option value="a">A</option><option value="b">B</option></select>
        <select multiple v-model="selected"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>
      </div>
    </template>
  `);
  const state = createApp(render, { tags: ['a'], choice: 'b', selected: ['a', 'c'] }).mount(root);
  const [tagA, tagB] = root.querySelectorAll('input');
  const [choice, selected] = root.querySelectorAll('select');
  assert.equal(tagA.checked, true);
  assert.equal(tagB.checked, false);
  assert.equal(choice.value, 'b');
  assert.deepEqual([...selected.selectedOptions].map(option => option.value), ['a', 'c']);
  tagB.checked = true;
  tagB.dispatchEvent(new Event('change', { bubbles: true }));
  tagA.checked = false;
  tagA.dispatchEvent(new Event('change', { bubbles: true }));
  choice.value = 'a';
  choice.dispatchEvent(new Event('change', { bubbles: true }));
  Object.defineProperty(selected, 'selectedOptions', { configurable: true, value: [selected.options[1]] });
  selected.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(state.tags, ['b']);
  assert.equal(state.choice, 'a');
  assert.deepEqual(state.selected, ['b']);
  delete selected.selectedOptions;
  await nextTick();
});

test('SFC v-for accepts tuple syntax and preserves keyed form nodes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><ul><li v-for="(item, index) of items" :key="item.id"><input :value="item.label"><span>{{index}}:{{item.label}}</span></li></ul></template>');
  const state = createApp(render, {
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }).mount(root);
  const [inputA, inputB] = root.querySelectorAll('input');
  inputB.value = 'Typing';
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  await nextTick();
  const [first, second] = root.querySelectorAll('input');
  assert.equal(first, inputB);
  assert.equal(second, inputA);
  assert.equal(first.value, 'B2');
  assert.deepEqual([...root.querySelectorAll('span')].map(node => node.textContent), ['0:B2', '1:A']);
});

test('SFC evaluates v-else-if chains in sibling order', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><div><p v-if="mode === 1">one</p><p v-else-if="mode === 2">two</p><p v-else>other</p></div></template>');
  const state = createApp(render, { mode: 1 }).mount(root);
  assert.equal(root.querySelector('p').textContent, 'one');
  state.mode = 2;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'two');
  state.mode = 3;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'other');
});

test('SFC v-html replaces child VNodes and virtual DOM restores them cleanly', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><section><div v-html="markup"><span>Ignored</span></div></section></template>');
  const state = createApp(render, { markup: '<strong>One</strong>' }).mount(root);
  const target = root.querySelector('div');
  assert.equal(target.innerHTML, '<strong>One</strong>');
  assert.equal(target.querySelector('span'), null);
  state.markup = '<em>Two</em>';
  await nextTick();
  assert.equal(target.innerHTML, '<em>Two</em>');

  const treeState = reactive({ raw: true, markup: '<b>Raw</b>' });
  const treeRoot = document.createElement('main');
  const app = createApp(state => h('div', state.raw ? { innerHTML: state.markup } : {}, state.raw ? [] : [h('span', {}, 'VNode')]), treeState);
  app.mount(treeRoot);
  treeState.raw = false;
  await nextTick();
  assert.equal(treeRoot.querySelector('div').innerHTML, '<span>VNode</span>');
  treeState.raw = true;
  treeState.markup = '<i>Again</i>';
  await nextTick();
  assert.equal(treeRoot.querySelector('div').innerHTML, '<i>Again</i>');
});

test('SFC resolves registered child components into the VDOM tree', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-child-test', props => h('strong', { class: 'child' }, String(props.label)));
  const render = compileSfcComponent('<template><section><Child :label="message" /></section></template>');
  const state = createApp(render, { message: 'Before', components: { Child } }).mount(root);
  const child = root.querySelector('strong');
  assert.equal(child.textContent, 'Before');
  state.message = 'After';
  await nextTick();
  assert.equal(root.querySelector('strong'), child);
  assert.equal(child.textContent, 'After');
});

test('SFC renders named slots, direct slot content, and slot fallbacks', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Card = compileSfcComponent(`
    <template>
      <article>
        <header><slot name="header"><h1>Fallback header</h1></slot></header>
        <main><slot><p>Fallback body</p></slot></main>
        <footer><slot name="footer"><small>Fallback footer</small></slot></footer>
      </article>
    </template>
  `);
  const render = compileSfcComponent(`
    <template>
      <Card>
        <template v-slot:header><h2>{{ title }}</h2></template>
        <p slot="footer">{{ footer }}</p>
        <strong>{{ body }}</strong>
      </Card>
    </template>
  `);
  const state = createApp(render, {
    title: 'Heading', body: 'Body', footer: 'Footer', components: { Card }
  }).mount(root);
  assert.equal(root.querySelector('h2').textContent, 'Heading');
  assert.equal(root.querySelector('main strong').textContent, 'Body');
  assert.equal(root.querySelector('footer p').textContent, 'Footer');
  assert.equal(root.querySelector('small'), null);
  state.title = 'Updated';
  await nextTick();
  assert.equal(root.querySelector('h2').textContent, 'Updated');

  const fallbackRoot = document.createElement('main');
  createApp(() => h(Card)).mount(fallbackRoot);
  assert.equal(fallbackRoot.querySelector('h1').textContent, 'Fallback header');
  assert.equal(fallbackRoot.querySelector('main p').textContent, 'Fallback body');
  assert.equal(fallbackRoot.querySelector('small').textContent, 'Fallback footer');
});

test('SFC resolves dynamic native and registered component targets', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('dynamic-child-test', () => h('strong', {}, 'Child'));
  const render = compileSfcComponent('<template><component :is="current">Dynamic</component></template>');
  const state = createApp(render, { current: 'em', components: { Child } }).mount(root);
  assert.equal(root.querySelector('em').textContent, 'Dynamic');
  state.current = Child;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Child');
});

test('SFC supports object spread bindings for native and child component props', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-bind-test', props => h('strong', {}, `${props.label}:${props.active}`));
  const render = compileSfcComponent('<template><div><input v-bind="inputProps"><Child v-bind="childProps" /></div></template>');
  const state = createApp(render, {
    inputProps: { title: 'Editor', value: 'draft' },
    childProps: { label: 'Ready', active: true },
    components: { Child }
  }).mount(root);
  const input = root.querySelector('input');
  assert.equal(input.title, 'Editor');
  assert.equal(input.value, 'draft');
  assert.equal(root.querySelector('strong').textContent, 'Ready:true');
  state.childProps = { label: 'Done', active: false };
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Done:false');
});

test('SFC script setup compiles safe reactive declarations and event methods', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const saves = [];
  const component = compileSfcComponent(`
    <template>
      <section>
        <input v-model="count">
        <strong>{{ count }} / {{ doubled }}</strong>
        <button @click="increment">Increment</button>
        <button @click="save">Save</button>
      </section>
    </template>
    <script setup>
      const count = ref(1);
      const doubled = computed(() => count * 2);
      function increment() { count.value++; }
      const save = () => emit('save', count.value);
    </script>
  `);
  const app = createApp(() => h(component, { onSave: value => saves.push(value) }));
  app.mount(root);
  const input = root.querySelector('input');
  const [increment, save] = root.querySelectorAll('button');
  assert.equal(root.querySelector('strong').textContent, '1 / 2');
  increment.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '2 / 4');
  input.value = '3';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '3 / 6');
  save.dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(saves, ['3']);
  app.unmount();
});

test('hydrates Thymeleaf bindings and synchronizes model values', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<span data-tr-text="user.name"></span><input data-tr-model="user.name"><div data-tr-show="visible"></div>';
  const state = hydrate(root, { user: { name: 'Ada' }, visible: false });
  assert.equal(root.querySelector('span').textContent, 'Ada');
  assert.equal(root.querySelector('div').hidden, true);
  state.user.name = 'Grace';
  await nextTick();
  assert.equal(root.querySelector('span').textContent, 'Grace');
  const input = root.querySelector('input');
  input.value = 'Lin';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.user.name, 'Lin');
});

test('hydrates checkbox radio and multiple-select model bindings', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = [
    '<input type="checkbox" data-tr-model="enabled">',
    '<input type="checkbox" value="a" data-tr-model="tags">',
    '<input type="checkbox" value="b" data-tr-model="tags">',
    '<input type="radio" name="choice" value="a" data-tr-model="choice">',
    '<input type="radio" name="choice" value="b" data-tr-model="choice">',
    '<select multiple data-tr-model="selected"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>'
  ].join('');
  const state = hydrate(root, { enabled: true, tags: ['a'], choice: 'b', selected: ['b', 'c'] });
  const [enabled, tagA, tagB, choiceA, choiceB] = root.querySelectorAll('input');
  const select = root.querySelector('select');
  assert.equal(enabled.checked, true);
  assert.equal(tagA.checked, true);
  assert.equal(tagB.checked, false);
  assert.equal(choiceA.checked, false);
  assert.equal(choiceB.checked, true);
  assert.deepEqual([...select.selectedOptions].map(option => option.value), ['b', 'c']);

  enabled.checked = false;
  enabled.dispatchEvent(new Event('change', { bubbles: true }));
  tagB.checked = true;
  tagB.dispatchEvent(new Event('change', { bubbles: true }));
  choiceA.checked = true;
  choiceA.dispatchEvent(new Event('change', { bubbles: true }));
  Object.defineProperty(select, 'selectedOptions', { configurable: true, value: [select.options[0]] });
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.enabled, false);
  assert.deepEqual(state.tags, ['a', 'b']);
  assert.equal(state.choice, 'a');
  assert.deepEqual(state.selected, ['a']);
  delete select.selectedOptions;

  state.tags = ['b'];
  state.choice = 'b';
  state.selected = ['c'];
  await nextTick();
  assert.equal(tagA.checked, false);
  assert.equal(tagB.checked, true);
  assert.equal(choiceA.checked, false);
  assert.equal(choiceB.checked, true);
  assert.deepEqual([...select.options].filter(option => option.selected).map(option => option.value), ['c']);
});

test('hydrates dynamic attributes, classes, and styles reactively', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<a data-tr-attr="title:user.name,aria-label:user.name" data-tr-class="classes" data-tr-style="styles">Link</a>';
  const state = hydrate(root, {
    user: { name: 'Ada' },
    classes: { active: true, muted: false },
    styles: { color: 'red', display: 'block' }
  });
  const link = root.querySelector('a');
  assert.equal(link.getAttribute('title'), 'Ada');
  assert.equal(link.getAttribute('aria-label'), 'Ada');
  assert.equal(link.className, 'active');
  assert.equal(link.style.color, 'red');
  state.user.name = 'Grace';
  state.classes = { active: false, muted: true };
  state.styles = { color: 'blue' };
  await nextTick();
  assert.equal(link.getAttribute('title'), 'Grace');
  assert.equal(link.className, 'muted');
  assert.equal(link.style.color, 'blue');
  assert.equal(link.style.display, '');
});

test('hydration removes stale dynamic attrs and normalizes nested class values', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<a class="server-class" style="font-weight: bold" data-tr-attr="attrs" data-tr-class="classes" data-tr-style="styles" data-static="keep">Link</a>';
  const state = hydrate(root, {
    attrs: { title: 'Before', 'aria-label': 'Before' },
    classes: ['base', { active: true }, ['nested']],
    styles: { color: 'red' }
  });
  const link = root.querySelector('a');
  assert.equal(link.getAttribute('title'), 'Before');
  assert.equal(link.getAttribute('aria-label'), 'Before');
  assert.equal(link.className, 'server-class base active nested');
  assert.equal(link.style.fontWeight, 'bold');
  state.attrs = { title: 'After' };
  state.classes = ['base', { active: false, next: true }];
  state.styles = null;
  await nextTick();
  assert.equal(link.getAttribute('title'), 'After');
  assert.equal(link.hasAttribute('aria-label'), false);
  assert.equal(link.getAttribute('data-static'), 'keep');
  assert.equal(link.className, 'server-class base next');
  assert.equal(link.style.fontWeight, 'bold');
  assert.equal(link.style.color, '');
});

test('evaluates safe arithmetic logical and conditional template expressions', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = [
    '<strong data-tr-text="count + 1"></strong>',
    '<p data-tr-if="count > 0 && visible">Visible count</p>',
    '<a data-tr-attr="title:count > 1 ? \'many\' : \'one\'">Link</a>',
    '<div data-tr-class="count > 0 && visible ? \'active\' : \'muted\'"></div>'
  ].join('');
  const state = hydrate(root, { count: 1, visible: true });
  assert.equal(root.querySelector('strong').textContent, '2');
  assert.equal(root.querySelector('p').textContent, 'Visible count');
  assert.equal(root.querySelector('a').getAttribute('title'), 'one');
  assert.equal(root.querySelector('div').className, 'active');
  state.count = 2;
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '3');
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('a').getAttribute('title'), 'many');
  assert.equal(root.querySelector('div').className, 'muted');
});

test('hydrates conditional blocks by mounting and unmounting their DOM nodes', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible">Only when visible</p>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  state.visible = true;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('p'), null);
});

test('hydrates server-hidden conditional blocks and reveals them reactively', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible" hidden>Only when visible</p><div data-tr-show="visible" hidden>Shown when visible</div>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('div').hidden, true);
  state.visible = true;
  await nextTick();
  assert.equal(root.querySelector('p').hidden, false);
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  assert.equal(root.querySelector('div').hidden, false);
});

test('hydrates keyed each bindings with scoped reactive rows', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label"></li>';
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  let rows = root.querySelectorAll('li');
  const firstA = rows[0];
  const firstB = rows[1];
  assert.deepEqual([...rows].map(row => row.textContent), ['A', 'B']);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  await nextTick();
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
  state.items.pop();
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['B2', 'A']);
});

test('hydrates server-rendered each rows without duplicating them', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = [
    '<li data-tr-each="item in items" data-tr-key="a" data-tr-key-expression="item.id" data-tr-text="item.label">A</li>',
    '<li data-tr-each="item in items" data-tr-key="b" data-tr-key-expression="item.id" data-tr-text="item.label">B</li>'
  ].join('');
  const initialRows = root.querySelectorAll('li');
  const firstA = initialRows[0];
  const firstB = initialRows[1];
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  let rows = root.querySelectorAll('li');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], firstA);
  assert.equal(rows[1], firstB);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  await nextTick();
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
});

test('each row scopes inherit outer reactive state for expressions', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label + suffix"></li>';
  const state = hydrate(root, { suffix: '!', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A!', 'B!']);
  state.suffix = '?';
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A?', 'B?']);
  state.items[0].label = 'Alpha';
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['Alpha?', 'B?']);
});

test('browser bootstrap preserves existing handlers and hydrates encoded server state', async () => {
  const document = installDom();
  document.body.innerHTML = '<main data-tr-component="counter" data-tr-state="{&quot;count&quot;:2}"><p data-tr-text="count">stale</p></main>';
  window.ThymeleafReactive = { handlers: { increment(state) { state.count++; } } };
  globalThis.EventSource = undefined;
  await import(`./dist/browser.js?bootstrap=${Date.now()}`);
  const count = document.querySelector('p');
  assert.equal(count.textContent, '2');
  assert.equal(typeof window.ThymeleafReactive.hydrate, 'function');
});

test('hydrates tr:on handlers with event arguments and modifiers', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button data-tr-on="click.prevent.stop.once:save">Save</button>';
  let calls = 0;
  let received;
  const state = hydrate(root, {}, {
    save(current, event) {
      calls++;
      received = [current, event.type];
    }
  });
  const button = root.querySelector('button');
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(received, [state, 'click']);
  assert.equal(calls, 1);
  assert.equal(event.defaultPrevented, true);
});

test('hydrates tr:html content reactively', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<section data-tr-html="content">stale</section>';
  const state = hydrate(root, { content: '<strong>Ready</strong>' });
  const section = root.querySelector('section');
  assert.equal(section.innerHTML, '<strong>Ready</strong>');
  state.content = '<em>Updated</em>';
  await nextTick();
  assert.equal(section.innerHTML, '<em>Updated</em>');
});

test('Suspense renders fallback until an async component resolves', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let resolve;
  const Async = defineAsyncComponent(() => new Promise(done => { resolve = done; }));
  const app = createApp(() => h(Suspense, { fallback: h('p', {}, 'Waiting') }, [h(Async)]));
  app.mount(root);
  assert.equal(root.textContent, 'Waiting');
  resolve(() => h('strong', {}, 'Ready'));
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Ready');
  assert.equal(root.querySelector('p'), null);
  app.unmount();
});

test('Transition runs enter and leave lifecycle hooks around keyed replacement', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = reactive({ showFirst: true });
  const events = [];
  const app = createApp(() => h(Transition, {
    name: 'fade',
    onBeforeEnter: () => events.push('before-enter'),
    onAfterEnter: () => events.push('after-enter'),
    onBeforeLeave: () => events.push('before-leave'),
    onAfterLeave: () => events.push('after-leave')
  }, [h('p', { key: state.showFirst ? 'first' : 'second' }, state.showFirst ? 'First' : 'Second')]));
  app.mount(root);
  assert.equal(root.textContent, 'First');
  assert.deepEqual(events, ['before-enter']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(events, ['before-enter', 'after-enter']);
  state.showFirst = false;
  await nextTick();
  assert.equal(root.textContent, 'SecondFirst');
  assert.deepEqual(events.slice(-1), ['before-leave']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(root.textContent, 'Second');
  assert.deepEqual(events.slice(-2), ['after-enter', 'after-leave']);
  app.unmount();
});

test('TransitionGroup preserves keyed nodes and transitions list additions and removals', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = reactive({ items: ['a', 'b'] });
  const events = [];
  const app = createApp(() => h(TransitionGroup, {
    tag: 'ul',
    name: 'list',
    onAfterEnter: element => events.push(`enter:${element.textContent}`),
    onAfterLeave: element => events.push(`leave:${element.textContent}`)
  }, state.items.map(item => h('li', { key: item }, item))));
  app.mount(root);
  const first = root.querySelector('li');
  state.items = ['b', 'c'];
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['b', 'c', 'a']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(events.includes('enter:c'));
  assert.ok(events.includes('leave:a'));
  assert.equal(first.parentNode, null);
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['b', 'c']);
  assert.equal(root.querySelectorAll('li')[0].textContent, 'b');
  app.unmount();
});
