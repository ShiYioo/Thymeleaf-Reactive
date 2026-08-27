const effectStack = [];
const proxyCache = new WeakMap();

export function reactive(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value.__trProxy) return value;
  if (proxyCache.has(value)) return proxyCache.get(value);
  const deps = new Map();
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (key === '__trProxy') return true;
      const active = effectStack.at(-1);
      if (active) {
        let set = deps.get(key);
        if (!set) deps.set(key, set = new Set());
        set.add(active);
      }
      const result = Reflect.get(target, key, receiver);
      return result && typeof result === 'object' ? reactive(result) : result;
    },
    set(target, key, next, receiver) {
      const previous = target[key];
      const changed = !Object.is(previous, next);
      const ok = Reflect.set(target, key, next, receiver);
      if (changed) deps.get(key)?.forEach(run => run());
      return ok;
    },
    deleteProperty(target, key) {
      const existed = key in target;
      const ok = Reflect.deleteProperty(target, key);
      if (existed) deps.get(key)?.forEach(run => run());
      return ok;
    }
  });
  proxyCache.set(value, proxy);
  return proxy;
}

export function effect(fn) {
  const run = () => {
    effectStack.push(run);
    try { return fn(); } finally { effectStack.pop(); }
  };
  run();
  return run;
}

export function h(type, props = {}, children = []) {
  return {
    type,
    props,
    children: (Array.isArray(children) ? children : [children]).map(normalizeVNode),
    el: null,
    key: props.key
  };
}

function normalizeVNode(value) {
  if (typeof value === 'string' || typeof value === 'number') return { type: Text, children: String(value), el: null };
  return value;
}

function setProp(el, key, value, previous) {
  if (key === 'key') return;
  if (key.startsWith('on') && typeof value === 'function') {
    const event = key.slice(2).toLowerCase();
    if (previous) el.removeEventListener(event, previous);
    el.addEventListener(event, value);
  } else if (value == null || value === false) el.removeAttribute(key);
  else if (value === true) el.setAttribute(key, '');
  else if (key in el && !key.includes('-')) el[key] = value;
  else el.setAttribute(key, String(value));
}

function mount(vnode, container, anchor = null) {
  vnode = normalizeVNode(vnode);
  if (typeof vnode.type === 'function') {
    vnode.component = vnode.type(vnode.props || {}, vnode.children);
    mount(vnode.component, container, anchor);
    vnode.el = vnode.component.el;
    return vnode;
  }
  if (vnode.type === Text) {
    vnode.el = document.createTextNode(vnode.children);
    container.insertBefore(vnode.el, anchor); return vnode;
  }
  const el = vnode.el = document.createElement(vnode.type);
  Object.entries(vnode.props || {}).forEach(([k, v]) => setProp(el, k, v));
  vnode.children.forEach(child => mount(child, el));
  container.insertBefore(el, anchor); return vnode;
}

function patchChildren(el, oldChildren, newChildren) {
  const oldKeyed = new Map(oldChildren.map((child, index) => [child.key ?? index, { child, index }]));
  let anchor = null;
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const next = normalizeVNode(newChildren[i]);
    const match = oldKeyed.get(next.key ?? i);
    if (match) {
      patch(match.child, next, el);
      if (match.index !== i) el.insertBefore(next.el, anchor);
      oldKeyed.delete(next.key ?? i);
    } else mount(next, el, anchor);
    anchor = next.el;
  }
  oldKeyed.forEach(({ child }) => el.removeChild(child.el));
}

export function patch(oldVNode, newVNode, container) {
  if (!oldVNode) return mount(newVNode, container);
  if (!newVNode) { container.removeChild(oldVNode.el); return null; }
  if (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key) {
    const next = mount(newVNode, container, oldVNode.el); container.removeChild(oldVNode.el); return next;
  }
  newVNode.el = oldVNode.el;
  if (typeof newVNode.type === 'function') {
    const nextComponent = newVNode.type(newVNode.props || {}, newVNode.children);
    patch(oldVNode.component, nextComponent, container);
    newVNode.component = nextComponent;
    newVNode.el = nextComponent.el;
    return newVNode;
  }
  if (newVNode.type === Text) { if (oldVNode.children !== newVNode.children) newVNode.el.nodeValue = newVNode.children; return newVNode; }
  const oldProps = oldVNode.props || {}, newProps = newVNode.props || {};
  Object.keys({ ...oldProps, ...newProps }).forEach(k => { if (oldProps[k] !== newProps[k]) setProp(newVNode.el, k, newProps[k], oldProps[k]); });
  patchChildren(newVNode.el, oldVNode.children, newVNode.children);
  return newVNode;
}

export function createApp(render, state = {}) {
  const reactiveState = reactive(state);
  return { mount(root) { let tree; effect(() => { tree = patch(tree, render(reactiveState), root); }); return reactiveState; } };
}

export const Text = Symbol('text');
