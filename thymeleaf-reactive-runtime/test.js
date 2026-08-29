import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { adoptComponentRoot, reactive, ref, effect, computed, compileSfcComponent, connectComponentHmr, createApp, defineAsyncComponent, defineComponent, effectScope, Fragment, h, hotUpdate, hydrate, nextTick, onScopeDispose, refreshComponentsFromPage, render, Teleport, inject, isRef, onMounted, onUnmounted, onUpdated, provide, proxyRefs, toRef, toRefs, unref, watch, watchEffect } from './dist/index.js';

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
  assert.equal(root.textContent, 'Ready');
  app.unmount();

  const Failed = defineAsyncComponent({
    loader: () => Promise.reject(new Error('offline')),
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  createApp(() => h(Failed)).mount(root);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(root.textContent, 'Error:offline');
});

test('proxyRefs unwraps values and writes through existing refs', () => {
  const count = ref(1);
  const state = proxyRefs({ count, label: 'Before' });
  assert.equal(isRef(count), true);
  assert.equal(unref(count), 1);
  assert.equal(state.count, 1);
  state.count = 2;
  state.label = 'After';
  assert.equal(count.value, 2);
  assert.equal(state.label, 'After');
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

test('component HMR preserves script setup local refs while replacing its template', () => {
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

test('component HMR recreates script setup state when its script changes', () => {
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

test('adopted script setup components preserve local refs across HMR', () => {
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

test('keyed fragment children move their full DOM ranges together', () => {
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
  assert.equal(document.querySelector('strong').textContent, 'Grace');
});

test('component hydration does not bind descendants owned by nested components', () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="outer"><p data-tr-text="label"></p><section data-tr-component="inner"><p data-tr-text="label"></p></section></section>';
  const outerRoot = document.querySelector('[data-tr-component="outer"]');
  const innerRoot = document.querySelector('[data-tr-component="inner"]');
  const outer = hydrate(outerRoot, { label: 'Outer' });
  const inner = hydrate(innerRoot, { label: 'Inner' });
  const labels = document.querySelectorAll('p');
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer', 'Inner']);
  outer.label = 'Outer updated';
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer updated', 'Inner']);
  inner.label = 'Inner updated';
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

test('virtual DOM patches changed content without replacing keyed input nodes', () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(state => h('section', {}, [
    h('input', { key: 'draft', value: state.draft }),
    h('strong', { key: 'count' }, String(state.count))
  ]), { draft: 'kept', count: 0 });
  const state = app.mount(root);
  const input = root.querySelector('input');
  state.count = 1;
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

test('Teleport patches and moves its child range without recreating keyed fields', () => {
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
  assert.equal(firstTarget.querySelector('input'), input);
  assert.equal(firstTarget.querySelector('strong').textContent, 'After');

  state.target = '#second-target';
  assert.equal(firstTarget.querySelector('input'), null);
  assert.equal(secondTarget.querySelector('input'), input);
  assert.equal(secondTarget.querySelector('strong').textContent, 'After');

  state.visible = false;
  assert.equal(secondTarget.childNodes.length, 0);
  app.unmount();
});

test('object components retain setup state and support lifecycle, emits, and injection', () => {
  const document = installDom();
  const root = document.createElement('main');
  const hooks = [];
  const emitted = [];
  const Child = {
    setup(props, { emit }) {
      const prefix = inject('prefix');
      const clicks = ref(0);
      onMounted(() => hooks.push('child-mounted'));
      onUpdated(() => hooks.push('child-updated'));
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
  assert.deepEqual(hooks, ['child-mounted', 'parent-mounted']);

  button.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(button.textContent, 'injected:Before:1');
  assert.deepEqual(emitted, [1]);
  assert.equal(hooks.includes('child-updated'), true);

  state.label = 'After';
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'injected:After:1');
  assert.equal(hooks.includes('parent-updated'), true);

  app.unmount();
  assert.equal(root.childNodes.length, 0);
  assert.equal(hooks.includes('child-unmounted'), true);
  assert.equal(hooks.includes('parent-unmounted'), true);
});

test('virtual DOM performs keyed moves and insertions while updating props and listeners', () => {
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

test('virtual DOM removes stale event listeners and style properties', () => {
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
  button.dispatchEvent(new Event('click'));
  assert.equal(oldClicks, 0);
  assert.equal(newClicks, 1);
  assert.equal(button.style.color, 'green');
  assert.equal(button.style.background, '');
});

test('SFC render tracks state, loops keyed children, and writes v-model values back', () => {
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
  assert.equal(root.querySelector('strong').textContent, '1');
  state.visible = false;
  assert.equal(root.querySelector('em').textContent, 'hidden');
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['B2', 'A']);
  const input = root.querySelector('input');
  input.value = 'Grace';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.name, 'Grace');
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

test('SFC resolves dynamic attribute and event arguments', () => {
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
  assert.equal(button.getAttribute('aria-label'), 'Second');
  button.dispatchEvent(new Event('click'));
  button.dispatchEvent(new Event('dblclick'));
  assert.equal(state.runs, 2);
});

test('SFC v-model supports checkbox arrays and select values', () => {
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
});

test('SFC v-for accepts tuple syntax and preserves keyed form nodes', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><ul><li v-for="(item, index) of items" :key="item.id"><input :value="item.label"><span>{{index}}:{{item.label}}</span></li></ul></template>');
  const state = createApp(render, {
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }).mount(root);
  const [inputA, inputB] = root.querySelectorAll('input');
  inputB.value = 'Typing';
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  const [first, second] = root.querySelectorAll('input');
  assert.equal(first, inputB);
  assert.equal(second, inputA);
  assert.equal(first.value, 'B2');
  assert.deepEqual([...root.querySelectorAll('span')].map(node => node.textContent), ['0:B2', '1:A']);
});

test('SFC evaluates v-else-if chains in sibling order', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><div><p v-if="mode === 1">one</p><p v-else-if="mode === 2">two</p><p v-else>other</p></div></template>');
  const state = createApp(render, { mode: 1 }).mount(root);
  assert.equal(root.querySelector('p').textContent, 'one');
  state.mode = 2;
  assert.equal(root.querySelector('p').textContent, 'two');
  state.mode = 3;
  assert.equal(root.querySelector('p').textContent, 'other');
});

test('SFC v-html replaces child VNodes and virtual DOM restores them cleanly', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><section><div v-html="markup"><span>Ignored</span></div></section></template>');
  const state = createApp(render, { markup: '<strong>One</strong>' }).mount(root);
  const target = root.querySelector('div');
  assert.equal(target.innerHTML, '<strong>One</strong>');
  assert.equal(target.querySelector('span'), null);
  state.markup = '<em>Two</em>';
  assert.equal(target.innerHTML, '<em>Two</em>');

  const treeState = reactive({ raw: true, markup: '<b>Raw</b>' });
  const treeRoot = document.createElement('main');
  const app = createApp(state => h('div', state.raw ? { innerHTML: state.markup } : {}, state.raw ? [] : [h('span', {}, 'VNode')]), treeState);
  app.mount(treeRoot);
  treeState.raw = false;
  assert.equal(treeRoot.querySelector('div').innerHTML, '<span>VNode</span>');
  treeState.raw = true;
  treeState.markup = '<i>Again</i>';
  assert.equal(treeRoot.querySelector('div').innerHTML, '<i>Again</i>');
});

test('SFC resolves registered child components into the VDOM tree', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-child-test', props => h('strong', { class: 'child' }, String(props.label)));
  const render = compileSfcComponent('<template><section><Child :label="message" /></section></template>');
  const state = createApp(render, { message: 'Before', components: { Child } }).mount(root);
  const child = root.querySelector('strong');
  assert.equal(child.textContent, 'Before');
  state.message = 'After';
  assert.equal(root.querySelector('strong'), child);
  assert.equal(child.textContent, 'After');
});

test('SFC renders named slots, direct slot content, and slot fallbacks', () => {
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
  assert.equal(root.querySelector('h2').textContent, 'Updated');

  const fallbackRoot = document.createElement('main');
  createApp(() => h(Card)).mount(fallbackRoot);
  assert.equal(fallbackRoot.querySelector('h1').textContent, 'Fallback header');
  assert.equal(fallbackRoot.querySelector('main p').textContent, 'Fallback body');
  assert.equal(fallbackRoot.querySelector('small').textContent, 'Fallback footer');
});

test('SFC resolves dynamic native and registered component targets', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('dynamic-child-test', () => h('strong', {}, 'Child'));
  const render = compileSfcComponent('<template><component :is="current">Dynamic</component></template>');
  const state = createApp(render, { current: 'em', components: { Child } }).mount(root);
  assert.equal(root.querySelector('em').textContent, 'Dynamic');
  state.current = Child;
  assert.equal(root.querySelector('strong').textContent, 'Child');
});

test('SFC supports object spread bindings for native and child component props', () => {
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
  assert.equal(root.querySelector('strong').textContent, 'Done:false');
});

test('SFC script setup compiles safe reactive declarations and event methods', () => {
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
  assert.equal(root.querySelector('strong').textContent, '2 / 4');
  input.value = '3';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(root.querySelector('strong').textContent, '3 / 6');
  save.dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(saves, ['3']);
  app.unmount();
});

test('hydrates Thymeleaf bindings and synchronizes model values', () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<span data-tr-text="user.name"></span><input data-tr-model="user.name"><div data-tr-show="visible"></div>';
  const state = hydrate(root, { user: { name: 'Ada' }, visible: false });
  assert.equal(root.querySelector('span').textContent, 'Ada');
  assert.equal(root.querySelector('div').hidden, true);
  state.user.name = 'Grace';
  assert.equal(root.querySelector('span').textContent, 'Grace');
  const input = root.querySelector('input');
  input.value = 'Lin';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.user.name, 'Lin');
});

test('hydrates checkbox radio and multiple-select model bindings', () => {
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
  assert.equal(tagA.checked, false);
  assert.equal(tagB.checked, true);
  assert.equal(choiceA.checked, false);
  assert.equal(choiceB.checked, true);
  assert.deepEqual([...select.options].filter(option => option.selected).map(option => option.value), ['c']);
});

test('hydrates dynamic attributes, classes, and styles reactively', () => {
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
  assert.equal(link.getAttribute('title'), 'Grace');
  assert.equal(link.className, 'muted');
  assert.equal(link.style.color, 'blue');
  assert.equal(link.style.display, '');
});

test('evaluates safe arithmetic logical and conditional template expressions', () => {
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
  assert.equal(root.querySelector('strong').textContent, '3');
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('a').getAttribute('title'), 'many');
  assert.equal(root.querySelector('div').className, 'muted');
});

test('hydrates conditional blocks by mounting and unmounting their DOM nodes', () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible">Only when visible</p>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  state.visible = true;
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  state.visible = false;
  assert.equal(root.querySelector('p'), null);
});

test('hydrates server-hidden conditional blocks and reveals them reactively', () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible" hidden>Only when visible</p><div data-tr-show="visible" hidden>Shown when visible</div>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('div').hidden, true);
  state.visible = true;
  assert.equal(root.querySelector('p').hidden, false);
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  assert.equal(root.querySelector('div').hidden, false);
});

test('hydrates keyed each bindings with scoped reactive rows', () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label"></li>';
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  let rows = root.querySelectorAll('li');
  const firstA = rows[0];
  const firstB = rows[1];
  assert.deepEqual([...rows].map(row => row.textContent), ['A', 'B']);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
  state.items.pop();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['B2', 'A']);
});

test('hydrates server-rendered each rows without duplicating them', () => {
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
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
});

test('each row scopes inherit outer reactive state for expressions', () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label + suffix"></li>';
  const state = hydrate(root, { suffix: '!', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A!', 'B!']);
  state.suffix = '?';
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A?', 'B?']);
  state.items[0].label = 'Alpha';
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
