import jsep from "jsep";

type Primitive = string | number | boolean | null | undefined;
export type Effect = (() => void) & { stop?: () => void };
export type Component = (props: Record<string, unknown>, children: VNode[]) => VNode;
export type RenderFunction = (state: any) => VNode;

const effectStack: Effect[] = [];
const proxyCache = new WeakMap<object, object>();
const reactiveProxies = new WeakSet<object>();
const effectDeps = new WeakMap<Effect, Set<Set<Effect>>>();
const ITERATE_KEY = Symbol("iterate");

export function reactive<T extends object>(value: T): T {
  if (reactiveProxies.has(value)) return value;
  if (proxyCache.has(value)) return proxyCache.get(value) as T;
  const deps = new Map<PropertyKey, Set<Effect>>();
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      const active = effectStack.at(-1);
      if (active) {
        let subscribers = deps.get(key);
        if (!subscribers) deps.set(key, subscribers = new Set());
        subscribers.add(active);
        let tracked = effectDeps.get(active);
        if (!tracked) effectDeps.set(active, tracked = new Set());
        tracked.add(subscribers);
      }
      const result = Reflect.get(target, key, receiver);
      return result && typeof result === 'object' ? reactive(result) : result;
    },
    set(target, key, next, receiver) {
      const oldLength = Array.isArray(target) ? target.length : 0;
      const changed = !Object.is(Reflect.get(target, key, receiver), next);
      const ok = Reflect.set(target, key, next, receiver);
      if (changed) {
        const triggered = new Set<Effect>(deps.get(key) ?? []);
        if (Array.isArray(target) && key !== "length") {
          if (Number.isInteger(Number(key)) && Number(key) >= oldLength) deps.get("length")?.forEach(run => triggered.add(run));
        }
        deps.get(ITERATE_KEY)?.forEach(run => triggered.add(run));
        [...triggered].forEach(run => run());
      }
      return ok;
    },
    deleteProperty(target, key) {
      const existed = key in target;
      const ok = Reflect.deleteProperty(target, key);
      if (existed) {
        const triggered = new Set<Effect>(deps.get(key) ?? []);
        deps.get(ITERATE_KEY)?.forEach(run => triggered.add(run));
        if (Array.isArray(target)) deps.get("length")?.forEach(run => triggered.add(run));
        [...triggered].forEach(run => run());
      }
      return ok;
    },
    ownKeys(target) {
      const active = effectStack.at(-1);
      if (active) {
        let subscribers = deps.get(ITERATE_KEY);
        if (!subscribers) deps.set(ITERATE_KEY, subscribers = new Set());
        subscribers.add(active);
        let tracked = effectDeps.get(active);
        if (!tracked) effectDeps.set(active, tracked = new Set());
        tracked.add(subscribers);
      }
      return Reflect.ownKeys(target);
    }
  });
  proxyCache.set(value, proxy);
  reactiveProxies.add(proxy);
  return proxy as T;
}

export function effect(fn: Effect): Effect {
  let active = true;
  const run: Effect = () => {
    if (!active) return;
    effectDeps.get(run)?.forEach(subscribers => subscribers.delete(run));
    effectDeps.delete(run);
    effectStack.push(run);
    try { fn(); } finally { effectStack.pop(); }
  };
  run.stop = () => {
    if (!active) return;
    active = false;
    effectDeps.get(run)?.forEach(subscribers => subscribers.delete(run));
    effectDeps.delete(run);
  };
  run();
  return run;
}

export const Text = Symbol("text");
export const Comment = Symbol("comment");
export const Fragment = Symbol("fragment");
type ComponentInstance = {
  vnode: VNode;
  tree: VNode;
  update: () => void;
  dispose: () => void;
};
export type VNode = {
  type: string | typeof Text | typeof Comment | typeof Fragment | Component;
  props: Record<string, unknown>;
  children: VNode[];
  el: Node | null;
  anchor?: Node | null;
  key?: string | number;
  component?: VNode;
  instance?: ComponentInstance;
  text?: string;
};

export function h(type: VNode["type"], props: Record<string, unknown> = {}, children: VNode["children"] | Primitive = []): VNode {
  const values = Array.isArray(children) ? children : [children];
  return {
    type,
    props,
    children: values.filter(value => value !== null && value !== undefined && value !== false).map(normalizeVNode),
    el: null,
    key: props.key as string | number | undefined
  };
}

function normalizeVNode(value: VNode | Primitive): VNode {
  if (typeof value === "object" && value !== null && "type" in value) return value as VNode;
  return { type: Text, props: {}, children: [], el: null, text: String(value ?? "") };
}

const eventListeners = new WeakMap<Element, Map<string, EventListener>>();
const componentNames = new WeakMap<Component, string>();

function setProp(el: Element, key: string, value: unknown, previous?: unknown): void {
  if (key === "key") return;
  if (key.startsWith("on")) {
    const event = key.slice(2).toLowerCase();
    const listeners = eventListeners.get(el) ?? new Map<string, EventListener>();
    const registered = listeners.get(event);
    if (registered) el.removeEventListener(event, registered);
    if (typeof value === "function") {
      const listener = value as EventListener;
      el.addEventListener(event, listener);
      listeners.set(event, listener);
    } else {
      listeners.delete(event);
    }
    if (listeners.size) eventListeners.set(el, listeners);
    else eventListeners.delete(el);
  } else if (key === "class" && value && typeof value === "object") {
    const classes = Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled)).map(([name]) => name).join(" ");
    el.className = classes;
  } else if (key === "style" && value && typeof value === "object") {
    const style = (el as HTMLElement).style;
    if (previous && typeof previous === "object") {
      Object.keys(previous as object).forEach(name => style.removeProperty(name));
    }
    Object.entries(value as Record<string, unknown>).forEach(([name, styleValue]) => {
      if (styleValue == null) style.removeProperty(name);
      else style.setProperty(name, String(styleValue));
    });
  } else if (value == null || value === false) el.removeAttribute(key);
  else if (value === true) {
    el.setAttribute(key, "");
    if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = true;
  } else if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = value;
  else el.setAttribute(key, String(value));
}

function mount(vnode: VNode, container: Node, anchor: Node | null = null): VNode {
  if (vnode.type === Text) {
    vnode.el = document.createTextNode(vnode.text ?? "");
    container.insertBefore(vnode.el, anchor);
    return vnode;
  }
  if (vnode.type === Comment) {
    vnode.el = document.createComment(vnode.text ?? "");
    container.insertBefore(vnode.el, anchor);
    return vnode;
  }
  if (vnode.type === Fragment) {
    const start = vnode.el = document.createComment("fragment");
    const end = vnode.anchor = document.createComment("/fragment");
    container.insertBefore(start, anchor);
    container.insertBefore(end, anchor);
    vnode.children.forEach(child => mount(child, container, end));
    return vnode;
  }
  if (typeof vnode.type === "function") {
    vnode.component = vnode.type(vnode.props, vnode.children);
    mount(vnode.component, container, anchor);
    vnode.el = vnode.component.el;
    vnode.anchor = vnode.component.anchor;
    const name = componentNames.get(vnode.type);
    const entry = name ? hotComponents.get(name) : undefined;
    if (entry) {
      const instance = {} as ComponentInstance;
      instance.vnode = vnode;
      instance.tree = vnode.component;
      instance.update = () => {
        const current = instance.vnode;
        const nextTree = entry.render(current.props, current.children);
        instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
        current.component = instance.tree;
        current.el = instance.tree.el;
        current.anchor = instance.tree.anchor;
      };
      instance.dispose = () => entry.instances.delete(instance.update);
      vnode.instance = instance;
      entry.instances.add(instance.update);
    }
    return vnode;
  }
  const el = vnode.el = document.createElement(vnode.type);
  Object.entries(vnode.props).forEach(([key, value]) => setProp(el as Element, key, value));
  vnode.children.forEach(child => mount(child, el));
  container.insertBefore(el, anchor);
  return vnode;
}

function unmount(vnode: VNode, container: Node): void {
  if (typeof vnode.type === "function") {
    vnode.instance?.dispose();
    if (vnode.component) unmount(vnode.component, container);
    return;
  }
  if (vnode.type === Fragment) {
    vnode.children.forEach(child => unmount(child, container));
    if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
    if (vnode.anchor?.parentNode === container) container.removeChild(vnode.anchor);
    return;
  }
  if (vnode.type !== Text && vnode.type !== Comment) vnode.children.forEach(child => unmount(child, vnode.el ?? container));
  if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
}

function moveVNode(vnode: VNode, container: Node, anchor: Node | null): void {
  const start = vnode.el;
  const end = vnode.anchor ?? start;
  if (!start || !end) return;
  let node: Node | null = start;
  while (node) {
    const next: Node | null = node === end ? null : node.nextSibling;
    container.insertBefore(node, anchor);
    if (!next) break;
    node = next;
  }
}

function patchChildren(container: Node, oldChildren: VNode[], newChildren: VNode[], endAnchor: Node | null = null): void {
  const oldKeyed = new Map<string | number, { child: VNode; index: number }>();
  const duplicateKeys = new Set<string | number>();
  oldChildren.forEach((child, index) => {
    const identity = child.key ?? index;
    if (child.key != null && oldKeyed.has(identity)) duplicateKeys.add(identity);
    else oldKeyed.set(identity, { child, index });
  });
  duplicateKeys.forEach(key => oldKeyed.delete(key));
  const used = new Set<VNode>();
  let anchor: Node | null = endAnchor;
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const next = newChildren[i];
    const identity = next.key ?? i;
    const match = !duplicateKeys.has(identity) ? oldKeyed.get(identity) : undefined;
    if (match) {
      patch(match.child, next, container);
      if (match.index !== i && next.el) moveVNode(next, container, anchor);
      oldKeyed.delete(identity);
      used.add(match.child);
    } else mount(next, container, anchor);
    anchor = next.el;
  }
  oldKeyed.forEach(({ child }) => {
    if (!used.has(child)) unmount(child, container);
  });
}

export function patch(oldVNode: VNode | undefined, newVNode: VNode | undefined, container: Node): VNode | null {
  if (!oldVNode && newVNode) return mount(newVNode, container);
  if (oldVNode && !newVNode) { unmount(oldVNode, container); return null; }
  if (!oldVNode || !newVNode) return null;
  if (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key) {
    const next = mount(newVNode, container, oldVNode.el);
    unmount(oldVNode, container);
    return next;
  }
  newVNode.el = oldVNode.el;
  newVNode.anchor = oldVNode.anchor;
  if (newVNode.type === Text || newVNode.type === Comment) {
    const oldText = oldVNode.text ?? "";
    const newText = newVNode.text ?? "";
    if (oldText !== newText && newVNode.el) newVNode.el.nodeValue = newText;
    return newVNode;
  }
  if (newVNode.type === Fragment) {
    patchChildren(container, oldVNode.children, newVNode.children, newVNode.anchor ?? null);
    return newVNode;
  }
  if (typeof newVNode.type === "function") {
    const instance = oldVNode.instance;
    if (instance) {
      instance.vnode = newVNode;
      const nextComponent = newVNode.type(newVNode.props, newVNode.children);
      instance.tree = patch(instance.tree, nextComponent, container) ?? instance.tree;
      newVNode.component = instance.tree;
      newVNode.instance = instance;
      newVNode.el = instance.tree.el;
      newVNode.anchor = instance.tree.anchor;
    } else {
      const nextComponent = newVNode.type(newVNode.props, newVNode.children);
      newVNode.component = patch(oldVNode.component, nextComponent, container) ?? nextComponent;
      newVNode.el = newVNode.component.el;
      newVNode.anchor = newVNode.component.anchor;
    }
    return newVNode;
  }
  const element = newVNode.el as Element;
  const oldProps = oldVNode.props;
  Object.keys({ ...oldProps, ...newVNode.props }).forEach(key => {
    if (oldProps[key] !== newVNode.props[key]) setProp(element, key, newVNode.props[key], oldProps[key]);
  });
  patchChildren(element, oldVNode.children, newVNode.children);
  return newVNode;
}

export function createApp(render: (state: any) => VNode, state: object = {}) {
  const reactiveState = reactive(state);
  let currentRender = render;
  let rerender: Effect | undefined;
  let mountedRoot: Element | undefined;
  let tree: VNode | undefined;
  return {
    mount(root: Element): object {
      if (rerender) this.unmount();
      mountedRoot = root;
      rerender = effect(() => { tree = patch(tree, currentRender(reactiveState), root) ?? undefined; });
      mountedApps.add(rerender);
      return reactiveState;
    },
    replaceRender(nextRender: (state: any) => VNode): void {
      currentRender = nextRender;
      rerender?.();
    },
    unmount(): void {
      if (!rerender || !mountedRoot) return;
      rerender.stop?.();
      mountedApps.delete(rerender);
      if (tree) unmount(tree, mountedRoot);
      rerender = undefined;
      mountedRoot = undefined;
      tree = undefined;
    }
  };
}

type HotComponent = { render: Component; instances: Set<() => void> };
const hotComponents = new Map<string, HotComponent>();
const mountedApps = new Set<Effect>();

/** Registers a named component so a compiler can replace its render function in development. */
export function defineComponent(name: string, render: Component): Component {
  const existing = hotComponents.get(name);
  if (existing) existing.render = render;
  else hotComponents.set(name, { render, instances: new Set() });
  const component: Component = (props, children) => {
    const entry = hotComponents.get(name);
    return (entry?.render ?? render)(props, children);
  };
  componentNames.set(component, name);
  return component;
}

/** Replaces one component's render function while preserving its mounted DOM/state. */
export function hotUpdate(name: string, render: Component): boolean {
  const entry = hotComponents.get(name);
  if (!entry) return false;
  entry.render = render;
  entry.instances.forEach(update => update());
  return true;
}

export type HmrMessage = { path: string; kind: string; version?: number };

export type ComponentHmrMessage = HmrMessage & {
  component?: string;
  moduleUrl?: string;
};

/** Connects the browser runtime to the Spring Boot SSE development channel. */
export function connectHmr(
  onTemplateChange: (message: HmrMessage) => void | Promise<void>,
  endpoint = "/__thymeleaf_reactive__/events"
): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource(endpoint);
  source.onmessage = event => {
    try {
      void Promise.resolve(onTemplateChange(JSON.parse(event.data) as HmrMessage))
        .catch(error => console.error("[thymeleaf-reactive] failed to apply HMR update", error));
    }
    catch (error) { console.warn("[thymeleaf-reactive] invalid HMR message", error); }
  };
  source.onerror = () => console.warn("[thymeleaf-reactive] HMR connection lost; browser will retry");
  return () => source.close();
}

/**
 * Connects HMR events to named components. A server/compiler can send a
 * module URL; the module must export its replacement render as `default`.
 */
export function connectComponentHmr(
  endpoint = "/__thymeleaf_reactive__/events",
  statusEndpoint = "/__thymeleaf_reactive__/status",
  pollInterval = 500
): () => void {
  let seenVersion = 0;
  let pollingInitialized = false;
  let polling = false;
  const applyChange = async (message: HmrMessage) => {
    const update = message as ComponentHmrMessage;
    if (typeof update.version === "number" && update.version <= seenVersion) return;
    if (!update.component) {
      window.dispatchEvent(new CustomEvent("thymeleaf-reactive:template-change", { detail: update }));
    } else if (!update.moduleUrl) {
      await refreshComponentsFromPage(update.component);
    } else {
      const module = await import(`${update.moduleUrl}?t=${Date.now()}`);
      const render = module.default ?? module.render;
      if (typeof render !== "function") throw new Error("HMR module has no render export");
      hotUpdate(update.component, render);
    }
    if (typeof update.version === "number") seenVersion = update.version;
  };
  let changeQueue = Promise.resolve();
  const enqueueChange = (message: HmrMessage): Promise<void> => {
    const work = changeQueue.then(() => applyChange(message));
    changeQueue = work.catch(() => undefined);
    return work;
  };
  const closeEvents = connectHmr(enqueueChange, endpoint);
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const separator = statusEndpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${statusEndpoint}${separator}since=${encodeURIComponent(seenVersion)}`, { cache: "no-store" });
      if (!response.ok) return;
      const status = await response.json() as {
        version?: number;
        lastChange?: ComponentHmrMessage;
        changes?: ComponentHmrMessage[];
        historyComplete?: boolean;
      };
      const version = status.version ?? 0;
      if (!pollingInitialized) { pollingInitialized = true; seenVersion = Math.max(seenVersion, version); return; }
      if (version <= seenVersion) return;
      if (status.historyComplete === false) {
        console.warn("[thymeleaf-reactive] HMR history is incomplete; reloading the page");
        window.location.reload();
        return;
      }
      const changes = (status.changes?.length ? status.changes : status.lastChange ? [status.lastChange] : [])
        .sort((left, right) => (left.version ?? 0) - (right.version ?? 0));
      if (!changes.length) {
        console.warn("[thymeleaf-reactive] missing HMR changes; reloading the page");
        window.location.reload();
        return;
      }
      for (const change of changes) await enqueueChange(change);
    } catch {
      // The EventSource channel remains the primary fast path; polling retries quietly.
    } finally {
      polling = false;
    }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, pollInterval);
  if (typeof timer === "object" && "unref" in timer) (timer as { unref(): void }).unref();
  return () => { closeEvents(); clearInterval(timer); };
}

function vnodeFromDom(node: Node): VNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return { type: Text, props: {}, children: [], el: node, text: node.textContent ?? "" };
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return { type: Comment, props: {}, children: [], el: node, text: node.textContent ?? "" };
  }
  const element = node as Element;
  const props = Object.fromEntries(Array.from(element.attributes).map(attribute => [attribute.name, attribute.value]));
  const key = element.getAttribute("data-tr-key") ?? element.getAttribute("key") ?? undefined;
  return {
    type: element.tagName.toLowerCase(),
    props,
    children: Array.from(element.childNodes).map(vnodeFromDom),
    el: node,
    key
  };
}

type FormState = { value?: string; checked?: boolean; selected?: string[]; start?: number | null; end?: number | null };
type HydrationContext = {
  state: object;
  handlers: Record<string, (...args: any[]) => any>;
  cleanups: Set<() => void>;
};
const hydrationContexts = new WeakMap<Element, HydrationContext>();

function disposeHydration(root: Element): void {
  const context = hydrationContexts.get(root);
  if (!context) return;
  [...context.cleanups].reverse().forEach(cleanup => cleanup());
  hydrationContexts.delete(root);
}

function belongsToNestedHydration(element: Element, root: Element): boolean {
  if (element === root) return false;
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== root) {
    if (hydrationContexts.has(ancestor)) return true;
    ancestor = ancestor.parentElement;
  }
  return hydrationContexts.has(element) && element !== root;
}

function fieldIdentity(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, index: number): string {
  return (field.dataset.trModel ?? field.getAttribute("data-tr-key") ?? field.id ?? field.name) || `field-${index}`;
}

function preserveFormState(root: Element): Map<string, FormState> {
  const state = new Map<string, FormState>();
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select").forEach((field, index) => {
    state.set(fieldIdentity(field, index), {
      value: field.value,
      checked: field instanceof HTMLInputElement ? field.checked : undefined,
      selected: field instanceof HTMLSelectElement && field.multiple
        ? Array.from(field.selectedOptions).map(option => option.value)
        : undefined,
      start: "selectionStart" in field ? field.selectionStart : null,
      end: "selectionEnd" in field ? field.selectionEnd : null
    });
  });
  return state;
}

function restoreFormState(root: Element, state: Map<string, FormState>): void {
  root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input,textarea,select").forEach((field, index) => {
    const previous = state.get(fieldIdentity(field, index));
    if (!previous) return;
    field.value = previous.value ?? field.value;
    if (field instanceof HTMLInputElement && previous.checked !== undefined) field.checked = previous.checked;
    if (field instanceof HTMLSelectElement && previous.selected) {
      Array.from(field.options).forEach(option => { option.selected = previous.selected!.includes(option.value); });
    }
    if (document.activeElement === field && "setSelectionRange" in field && previous.start != null && previous.end != null) {
      field.setSelectionRange(previous.start, previous.end);
    }
  });
}

type ComponentRootPair = { current: HTMLElement; next: HTMLElement };

function componentInstanceKey(root: HTMLElement): string | undefined {
  const key = root.dataset.trKey;
  return key ? `key:${key}` : undefined;
}

function pairComponentRoots(current: HTMLElement[], next: HTMLElement[]): {
  pairs: ComponentRootPair[];
  removed: HTMLElement[];
  added: HTMLElement[];
} {
  const countKeys = (roots: HTMLElement[]) => {
    const counts = new Map<string, number>();
    roots.forEach(root => {
      const key = componentInstanceKey(root);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  };
  const currentKeyCounts = countKeys(current);
  const nextKeyCounts = countKeys(next);
  const currentByKey = new Map<string, HTMLElement>();
  current.forEach(root => {
    const key = componentInstanceKey(root);
    if (key && currentKeyCounts.get(key) === 1) currentByKey.set(key, root);
  });

  const pairs: ComponentRootPair[] = [];
  const usedCurrent = new Set<HTMLElement>();
  const usedNext = new Set<HTMLElement>();
  next.forEach(root => {
    const key = componentInstanceKey(root);
    const match = key && nextKeyCounts.get(key) === 1 ? currentByKey.get(key) : undefined;
    if (match) {
      pairs.push({ current: match, next: root });
      usedCurrent.add(match);
      usedNext.add(root);
    }
  });

  const remainingCurrent = current.filter(root => !usedCurrent.has(root) && !componentInstanceKey(root));
  const remainingNext = next.filter(root => !usedNext.has(root) && !componentInstanceKey(root));
  const pairCount = Math.min(remainingCurrent.length, remainingNext.length);
  for (let index = 0; index < pairCount; index++) {
    pairs.push({ current: remainingCurrent[index], next: remainingNext[index] });
    usedCurrent.add(remainingCurrent[index]);
    usedNext.add(remainingNext[index]);
  }
  return {
    pairs,
    removed: current.filter(root => !usedCurrent.has(root)),
    added: next.filter(root => !usedNext.has(root))
  };
}

function parseComponentState(root: HTMLElement): object {
  const source = root.dataset.trState;
  if (!source) return {};
  try { return JSON.parse(source) as object; }
  catch {
    console.error("[thymeleaf-reactive] invalid data-tr-state JSON during HMR");
    return {};
  }
}

function hydrateComponentRoot(root: HTMLElement, context?: HydrationContext): void {
  const globalHandlers = (globalThis as { ThymeleafReactive?: { handlers?: Record<string, (...args: any[]) => any> } })
    .ThymeleafReactive?.handlers;
  const handlers = context?.handlers ?? globalHandlers ?? {};
  hydrate(root, context?.state ?? parseComponentState(root), handlers);
  root.dataset.trHydrated = "true";
}

function insertionPointForAddedComponent(
  nextRoot: HTMLElement,
  nextRoots: HTMLElement[],
  liveRoots: Map<HTMLElement, HTMLElement>
): { parent: Node; anchor: Node | null } | undefined {
  const index = nextRoots.indexOf(nextRoot);
  for (let cursor = index + 1; cursor < nextRoots.length; cursor++) {
    const peer = nextRoots[cursor];
    const live = liveRoots.get(peer);
    if (live?.parentNode && peer.parentElement === nextRoot.parentElement) return { parent: live.parentNode, anchor: live };
  }
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const peer = nextRoots[cursor];
    const live = liveRoots.get(peer);
    if (live?.parentNode && peer.parentElement === nextRoot.parentElement) return { parent: live.parentNode, anchor: live.nextSibling };
  }
  if (nextRoot.parentElement?.id) {
    const parent = document.getElementById(nextRoot.parentElement.id);
    if (parent) return { parent, anchor: null };
  }
  return undefined;
}

function reorderComponentRoots(nextRoots: HTMLElement[], liveRoots: Map<HTMLElement, HTMLElement>): void {
  let anchor: Node | null = null;
  for (let index = nextRoots.length - 1; index >= 0; index--) {
    const nextRoot = nextRoots[index];
    const liveRoot = liveRoots.get(nextRoot);
    if (!liveRoot?.parentNode) continue;
    const sibling = nextRoots[index + 1];
    const nextSibling = sibling ? liveRoots.get(sibling) : undefined;
    if (nextSibling?.parentNode && nextSibling.parentNode !== liveRoot.parentNode) continue;
    liveRoot.parentNode.insertBefore(liveRoot, anchor);
    anchor = liveRoot;
  }
}

/** Re-renders only components with this name from the current server-rendered page. */
export async function refreshComponentsFromPage(component: string): Promise<void> {
  const response = await fetch(window.location.href, {
    cache: "no-store",
    headers: { "X-Thymeleaf-Reactive": "hmr" }
  });
  if (!response.ok) throw new Error(`HMR refresh failed: ${response.status}`);
  const nextDocument = new DOMParser().parseFromString(await response.text(), "text/html");
  const current = Array.from(document.querySelectorAll<HTMLElement>("[data-tr-component]")).filter(node => node.dataset.trComponent === component);
  const next = Array.from(nextDocument.querySelectorAll<HTMLElement>("[data-tr-component]")).filter(node => node.dataset.trComponent === component);
  const { pairs, removed, added } = pairComponentRoots(current, next);
  const liveRoots = new Map<HTMLElement, HTMLElement>();
  pairs.forEach(({ current: root, next: nextRoot }) => {
    const parent = root.parentNode;
    if (!parent) return;
    const formState = preserveFormState(root);
    const context = hydrationContexts.get(root);
    const patched = patch(vnodeFromDom(root), vnodeFromDom(nextRoot), parent);
    if (patched?.el instanceof Element) {
      restoreFormState(patched.el, formState);
      const liveRoot = patched.el as HTMLElement;
      liveRoots.set(nextRoot, liveRoot);
      if (context) hydrateComponentRoot(liveRoot, context);
    }
  });
  removed.forEach(root => {
    disposeHydration(root);
    root.remove();
  });
  added.forEach(nextRoot => {
    const insertion = insertionPointForAddedComponent(nextRoot, next, liveRoots);
    if (!insertion) {
      console.warn(`[thymeleaf-reactive] could not place added ${component} component instance; reload may be required`);
      return;
    }
    const vnode = mount(vnodeFromDom(nextRoot), insertion.parent, insertion.anchor);
    if (vnode.el instanceof HTMLElement) {
      liveRoots.set(nextRoot, vnode.el);
      hydrateComponentRoot(vnode.el);
    }
  });
  reorderComponentRoots(next, liveRoots);
}

const expressionCache = new Map<string, any>();
const unsafePropertyNames = new Set(["__proto__", "constructor", "prototype"]);

function normalizedExpression(expression: string): string {
  const trimmed = expression.trim();
  return trimmed.startsWith("${") && trimmed.endsWith("}") ? trimmed.slice(2, -1).trim() : trimmed;
}

function readMember(source: any, property: any): any {
  if (source == null || unsafePropertyNames.has(String(property))) return undefined;
  return source[property];
}

function evaluateAst(node: any, scope: any): any {
  switch (node?.type) {
    case "Literal": return node.value;
    case "Identifier": return node.name === "undefined" ? undefined : readMember(scope, node.name);
    case "ThisExpression": return undefined;
    case "MemberExpression": {
      const target = evaluateAst(node.object, scope);
      const property = node.computed ? evaluateAst(node.property, scope) : node.property.name;
      return readMember(target, property);
    }
    case "ArrayExpression": return node.elements.map((element: any) => evaluateAst(element, scope));
    case "ObjectExpression": {
      const result: Record<string, any> = {};
      node.properties.forEach((property: any) => {
        const key = property.computed ? evaluateAst(property.key, scope) : property.key.name ?? property.key.value;
        if (!unsafePropertyNames.has(String(key))) result[String(key)] = evaluateAst(property.value, scope);
      });
      return result;
    }
    case "UnaryExpression": {
      const value = evaluateAst(node.argument, scope);
      if (node.operator === "!") return !value;
      if (node.operator === "+") return +value;
      if (node.operator === "-") return -value;
      if (node.operator === "~") return ~value;
      return undefined;
    }
    case "ConditionalExpression": return evaluateAst(node.test, scope)
      ? evaluateAst(node.consequent, scope)
      : evaluateAst(node.alternate, scope);
    case "BinaryExpression": {
      const left = evaluateAst(node.left, scope);
      if (node.operator === "&&") return left && evaluateAst(node.right, scope);
      if (node.operator === "||") return left || evaluateAst(node.right, scope);
      if (node.operator === "??") return left ?? evaluateAst(node.right, scope);
      const right = evaluateAst(node.right, scope);
      switch (node.operator) {
        case "==": return left == right; // Expressions intentionally mirror JavaScript template semantics.
        case "!=": return left != right;
        case "===": return left === right;
        case "!==": return left !== right;
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return left / right;
        case "%": return left % right;
        case "**": return left ** right;
        case "<": return left < right;
        case "<=": return left <= right;
        case ">": return left > right;
        case ">=": return left >= right;
        case "|": return left | right;
        case "&": return left & right;
        case "^": return left ^ right;
        default: return undefined;
      }
    }
    case "Compound": return node.body.reduce((value: any, entry: any) => evaluateAst(entry, scope), undefined);
    default: return undefined;
  }
}

function readPath(source: any, expression: string): any {
  const normalized = normalizedExpression(expression);
  if (!normalized) return undefined;
  try {
    const ast = expressionCache.get(normalized) ?? jsep(normalized);
    expressionCache.set(normalized, ast);
    return evaluateAst(ast, source);
  } catch (error) {
    console.warn(`[thymeleaf-reactive] invalid expression: ${expression}`, error);
    return undefined;
  }
}

function writePath(source: any, expression: string, value: any): void {
  const keys = expression.trim().split(".").filter(Boolean);
  if (!keys.length) return;
  const last = keys.pop()!;
  const target = keys.reduce((current, key) => current?.[key], source);
  if (target && typeof target === "object") target[last] = value;
}

function readDynamicObject(source: any, expression: string): any {
  const trimmed = expression.trim();
  if (trimmed.startsWith("{")) return readPath(source, trimmed);
  const match = trimmed.match(/^([^:]+):(.+)$/);
  if (!match) return readPath(source, trimmed);
  const result: Record<string, any> = {};
  trimmed.split(",").forEach(binding => {
    const separator = binding.indexOf(":");
    const name = separator >= 0 ? binding.slice(0, separator) : "";
    const path = separator >= 0 ? binding.slice(separator + 1) : "";
    if (name && path) result[name.trim()] = readPath(source, path);
  });
  return result;
}

type EachRecord = { element: HTMLElement; scope: any; key: string | number };

function parseEach(expression: string): { item: string; index?: string; collection: string } | null {
  const match = expression.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s+in\s+(.+)$/);
  return match ? { item: match[1], index: match[2], collection: match[3] } : null;
}

function eachKey(element: Element, scope: any, index: number): string | number {
  const expression = (element as HTMLElement).dataset.trKeyExpression ?? (element as HTMLElement).dataset.trKey;
  const value = expression ? readPath(scope, expression) : index;
  return typeof value === "string" || typeof value === "number" ? value : index;
}

function cloneEachTemplate(template: HTMLElement): HTMLElement {
  const holder = document.createElement("template");
  holder.innerHTML = template.outerHTML;
  const clone = holder.content.firstElementChild as HTMLElement;
  clone.removeAttribute("data-tr-each");
  return clone;
}

/** Hydrates server-rendered Thymeleaf metadata into reactive DOM bindings. */
export function hydrate(root: Element, state: object, handlers: Record<string, (...args: any[]) => any> = {}): object {
  disposeHydration(root);
  const reactiveState = reactive(state);
  const context: HydrationContext = { state: reactiveState, handlers, cleanups: new Set() };
  hydrationContexts.set(root, context);
  const cleanup = (dispose: () => void): void => { context.cleanups.add(dispose); };
  const componentRoot = root.matches("[data-tr-component]") ? root : undefined;
  const bindings = <T extends HTMLElement>(selector: string): T[] => [
    ...(root.matches(selector) ? [root as T] : []),
    ...Array.from(root.querySelectorAll<T>(selector))
  ].filter(element =>
    (!componentRoot || element === componentRoot || element.closest("[data-tr-component]") === componentRoot) &&
    !belongsToNestedHydration(element, root)
  );
  bindings<HTMLElement>("[data-tr-each]").forEach(template => {
    if (!template.parentNode || !template.dataset.trEach) return;
    const parsed = parseEach(template.dataset.trEach!);
    const parent = template.parentNode;
    if (!parsed || !parent) return;
    const serverRows: HTMLElement[] = [template];
    let sibling = template.nextElementSibling as HTMLElement | null;
    while (sibling?.dataset.trEach === template.dataset.trEach) {
      serverRows.push(sibling);
      sibling = sibling.nextElementSibling as HTMLElement | null;
    }
    const blueprint = template.cloneNode(true) as HTMLElement;
    serverRows.forEach(row => row.removeAttribute("data-tr-each"));
    const anchor = document.createComment("tr-each");
    parent.insertBefore(anchor, template);
    const records = new Map<string | number, EachRecord>();
    const runner = effect(() => {
      const collection = readPath(reactiveState, parsed.collection);
      const values = Array.isArray(collection) ? collection : collection && typeof collection === "object" ? Object.values(collection) : [];
      const nextKeys = new Set<string | number>();
      const nextRecords: EachRecord[] = [];
      values.forEach((item, index) => {
        const candidateScope = { [parsed.item]: item, ...(parsed.index ? { [parsed.index]: index } : {}) };
        const candidateKey = eachKey(blueprint, candidateScope, index);
        const previous = records.get(candidateKey);
        const scope = previous?.scope ?? reactive(candidateScope);
        if (previous) {
          scope[parsed.item] = item;
          if (parsed.index) scope[parsed.index] = index;
        }
        const key = eachKey(blueprint, scope, index);
        const record = previous ?? { element: serverRows[index] ?? cloneEachTemplate(blueprint), scope, key };
        record.element.dataset.trKey = String(key);
        if (!previous) hydrate(record.element, scope, handlers);
        nextKeys.add(key);
        nextRecords.push(record);
      });
      records.forEach((record, key) => {
        if (!nextKeys.has(key) && record.element.parentNode === parent) parent.removeChild(record.element);
      });
      let cursor: Node = anchor;
      nextRecords.forEach(record => {
        parent.insertBefore(record.element, cursor.nextSibling);
        cursor = record.element;
      });
      records.clear();
      nextRecords.forEach(record => records.set(record.key, record));
    });
    cleanup(() => {
      runner.stop?.();
      records.forEach(record => disposeHydration(record.element));
      serverRows.forEach(row => row.remove());
      anchor.remove();
    });
  });
  bindings<HTMLElement>("[data-tr-text]").forEach(element => {
    const expression = element.dataset.trText!;
    const runner = effect(() => { element.textContent = String(readPath(reactiveState, expression) ?? ""); });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-show]").forEach(element => {
    const expression = element.dataset.trShow!;
    const runner = effect(() => { element.hidden = !Boolean(readPath(reactiveState, expression)); });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-attr]").forEach(element => {
    const expression = element.dataset.trAttr!;
    const runner = effect(() => {
      const values = readDynamicObject(reactiveState, expression);
      if (!values || typeof values !== "object") return;
      Object.entries(values).forEach(([name, value]) => {
        if (value == null || value === false) element.removeAttribute(name);
        else element.setAttribute(name, value === true ? "" : String(value));
      });
    });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-class]").forEach(element => {
    const expression = element.dataset.trClass!;
    const runner = effect(() => {
      const value = readPath(reactiveState, expression);
      element.className = value && typeof value === "object"
        ? Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name).join(" ")
        : String(value ?? "");
    });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-style]").forEach(element => {
    const expression = element.dataset.trStyle!;
    const runner = effect(() => {
      const value = readPath(reactiveState, expression);
      const style = element.style;
      if (!value || typeof value !== "object") { element.removeAttribute("style"); return; }
      Array.from(style).forEach(name => style.removeProperty(name));
      Object.entries(value).forEach(([name, next]) => { if (next != null) style.setProperty(name, String(next)); });
    });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-if]").forEach(element => {
    const expression = element.dataset.trIf!;
    const parent = element.parentNode;
    if (!parent) return;
    const anchor = document.createComment("tr-if");
    parent.insertBefore(anchor, element);
    const runner = effect(() => {
      if (readPath(reactiveState, expression)) {
        element.hidden = false;
        if (element.parentNode !== parent) parent.insertBefore(element, anchor.nextSibling);
      } else if (element.parentNode === parent) {
        parent.removeChild(element);
      }
    });
    cleanup(() => {
      runner.stop?.();
      anchor.remove();
    });
  });
  bindings<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-tr-model]").forEach(element => {
    const expression = element.dataset.trModel!;
    const isCheckbox = element instanceof HTMLInputElement && element.type === "checkbox";
    const isRadio = element instanceof HTMLInputElement && element.type === "radio";
    const isMultipleSelect = element instanceof HTMLSelectElement && element.multiple;
    const runner = effect(() => {
      const value = readPath(reactiveState, expression);
      if (isCheckbox) {
        element.checked = Array.isArray(value) ? value.map(String).includes(element.value) : Boolean(value);
      } else if (isRadio) {
        element.checked = String(value ?? "") === element.value;
      } else if (isMultipleSelect) {
        const selected = new Set((Array.isArray(value) ? value : []).map(String));
        Array.from(element.options).forEach(option => { option.selected = selected.has(option.value); });
      } else if (!(element instanceof HTMLInputElement && element.type === "file")) {
        const next = String(value ?? "");
        if (element.value !== next) element.value = next;
      }
    });
    const listener = () => {
      if (isCheckbox) {
        const current = readPath(reactiveState, expression);
        if (Array.isArray(current)) {
          const values = current.map(String);
          const next = element.checked
            ? values.includes(element.value) ? values : [...values, element.value]
            : values.filter(value => value !== element.value);
          writePath(reactiveState, expression, next);
        } else writePath(reactiveState, expression, element.checked);
      } else if (isRadio) {
        if (element.checked) writePath(reactiveState, expression, element.value);
      } else if (isMultipleSelect) {
        writePath(reactiveState, expression, Array.from(element.selectedOptions).map(option => option.value));
      } else writePath(reactiveState, expression, element.value);
    };
    element.addEventListener(isCheckbox || isRadio || isMultipleSelect ? "change" : "input", listener);
    cleanup(() => {
      runner.stop?.();
      element.removeEventListener(isCheckbox || isRadio || isMultipleSelect ? "change" : "input", listener);
    });
  });
  bindings<HTMLElement>("[data-tr-on]").forEach(element => {
    const [event, name] = (element.dataset.trOn ?? "").split(":", 2);
    const handler = handlers[name];
    if (event && handler) {
      const listener = handler.bind(null, reactiveState);
      element.addEventListener(event, listener);
      cleanup(() => element.removeEventListener(event, listener));
    }
  });
  return reactiveState;
}
