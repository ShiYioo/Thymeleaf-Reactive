import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { reactive, effect, createApp, h, hydrate, refreshComponentsFromPage } from './dist/index.js';

function installDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
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
