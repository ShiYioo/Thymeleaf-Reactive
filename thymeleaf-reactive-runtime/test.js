import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { reactive, effect, createApp, defineComponent, Fragment, h, hotUpdate, hydrate, refreshComponentsFromPage } from './dist/index.js';

function installDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.DOMParser = window.DOMParser;
  globalThis.HTMLInputElement = window.HTMLInputElement;
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
