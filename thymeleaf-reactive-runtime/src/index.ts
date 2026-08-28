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
type ComponentInstance = {
  vnode: VNode;
  tree: VNode;
  update: () => void;
  dispose: () => void;
};
export type VNode = {
  type: string | typeof Text | Component;
  props: Record<string, unknown>;
  children: VNode[];
  el: Node | null;
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
  if (typeof vnode.type === "function") {
    vnode.component = vnode.type(vnode.props, vnode.children);
    mount(vnode.component, container, anchor);
    vnode.el = vnode.component.el;
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
  if (vnode.type !== Text) vnode.children.forEach(child => unmount(child, vnode.el ?? container));
  if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
}

function patchChildren(el: Element, oldChildren: VNode[], newChildren: VNode[]): void {
  const oldKeyed = new Map<string | number, { child: VNode; index: number }>();
  const duplicateKeys = new Set<string | number>();
  oldChildren.forEach((child, index) => {
    const identity = child.key ?? index;
    if (child.key != null && oldKeyed.has(identity)) duplicateKeys.add(identity);
    else oldKeyed.set(identity, { child, index });
  });
  duplicateKeys.forEach(key => oldKeyed.delete(key));
  const used = new Set<VNode>();
  let anchor: Node | null = null;
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const next = newChildren[i];
    const identity = next.key ?? i;
    const match = !duplicateKeys.has(identity) ? oldKeyed.get(identity) : undefined;
    if (match) {
      patch(match.child, next, el);
      if (match.index !== i && next.el) el.insertBefore(next.el, anchor);
      oldKeyed.delete(identity);
      used.add(match.child);
    } else mount(next, el, anchor);
    anchor = next.el;
  }
  oldKeyed.forEach(({ child }) => {
    if (!used.has(child)) unmount(child, el);
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
  if (newVNode.type === Text) {
    const oldText = oldVNode.text ?? "";
    const newText = newVNode.text ?? "";
    if (oldText !== newText && newVNode.el) newVNode.el.nodeValue = newText;
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
    } else {
      const nextComponent = newVNode.type(newVNode.props, newVNode.children);
      newVNode.component = patch(oldVNode.component, nextComponent, container) ?? nextComponent;
      newVNode.el = newVNode.component.el;
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
  onTemplateChange: (message: HmrMessage) => void,
  endpoint = "/__thymeleaf_reactive__/events"
): () => void {
  if (typeof EventSource === "undefined") return () => undefined;
  const source = new EventSource(endpoint);
  source.onmessage = event => {
    try { onTemplateChange(JSON.parse(event.data) as HmrMessage); }
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
  const applyChange = async (message: HmrMessage) => {
    const update = message as ComponentHmrMessage;
    if (typeof update.version === "number") seenVersion = Math.max(seenVersion, update.version);
    if (!update.component) {
      window.dispatchEvent(new CustomEvent("thymeleaf-reactive:template-change", { detail: update }));
      return;
    }
    if (!update.moduleUrl) {
      await refreshComponentsFromPage(update.component);
      return;
    }
    try {
      const module = await import(`${update.moduleUrl}?t=${Date.now()}`);
      const render = module.default ?? module.render;
      if (typeof render !== "function") throw new Error("HMR module has no render export");
      hotUpdate(update.component, render);
    } catch (error) {
      console.error(`[thymeleaf-reactive] failed to update ${update.component}`, error);
    }
  };
  const closeEvents = connectHmr(applyChange, endpoint);
  const poll = async () => {
    try {
      const response = await fetch(statusEndpoint, { cache: "no-store" });
      if (!response.ok) return;
      const status = await response.json() as { version?: number; lastChange?: ComponentHmrMessage };
      const version = status.version ?? 0;
      if (!pollingInitialized) { pollingInitialized = true; seenVersion = Math.max(seenVersion, version); return; }
      if (version > seenVersion && status.lastChange) await applyChange(status.lastChange);
    } catch {
      // The EventSource channel remains the primary fast path; polling retries quietly.
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

type FormState = { value?: string; checked?: boolean; start?: number | null; end?: number | null };
type HydrationContext = { state: object; handlers: Record<string, (...args: any[]) => any> };
const hydrationContexts = new WeakMap<Element, HydrationContext>();
const hydratedBindings = new WeakMap<Element, Set<string>>();

function bindingAlreadyHydrated(element: Element, kind: string): boolean {
  const bindings = hydratedBindings.get(element) ?? new Set<string>();
  if (bindings.has(kind)) return true;
  bindings.add(kind);
  hydratedBindings.set(element, bindings);
  return false;
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
    if (document.activeElement === field && "setSelectionRange" in field && previous.start != null && previous.end != null) {
      field.setSelectionRange(previous.start, previous.end);
    }
  });
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
  if (current.length !== next.length) throw new Error(`HMR component count changed for ${component}`);
  current.forEach((root, index) => {
    const parent = root.parentNode;
    if (!parent) return;
    const formState = preserveFormState(root);
    const patched = patch(vnodeFromDom(root), vnodeFromDom(next[index]), parent);
    if (patched?.el instanceof Element) {
      restoreFormState(patched.el, formState);
      const context = hydrationContexts.get(root);
      if (context) hydrate(patched.el, context.state, context.handlers);
    }
  });
}

function readPath(source: any, expression: string): any {
  return expression.trim().split(".").filter(Boolean).reduce((value, key) => value?.[key], source);
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
  const match = trimmed.match(/^([^:]+):(.+)$/);
  if (!match) return readPath(source, trimmed);
  const result: Record<string, any> = {};
  trimmed.split(",").forEach(binding => {
    const [name, path] = binding.split(":", 2);
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
  const expression = (element as HTMLElement).dataset.trKey;
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
  const reactiveState = reactive(state);
  hydrationContexts.set(root, { state: reactiveState, handlers });
  const bindings = <T extends HTMLElement>(selector: string): T[] => [
    ...(root.matches(selector) ? [root as T] : []),
    ...Array.from(root.querySelectorAll<T>(selector))
  ];
  bindings<HTMLElement>("[data-tr-each]").forEach(template => {
    if (bindingAlreadyHydrated(template, "each")) return;
    const parsed = parseEach(template.dataset.trEach!);
    const parent = template.parentNode;
    if (!parsed || !parent) return;
    const anchor = document.createComment("tr-each");
    parent.insertBefore(anchor, template);
    parent.removeChild(template);
    const records = new Map<string | number, EachRecord>();
    effect(() => {
      const collection = readPath(reactiveState, parsed.collection);
      const values = Array.isArray(collection) ? collection : collection && typeof collection === "object" ? Object.values(collection) : [];
      const nextKeys = new Set<string | number>();
      const nextRecords: EachRecord[] = [];
      values.forEach((item, index) => {
        const candidateScope = reactive({ [parsed.item]: item, ...(parsed.index ? { [parsed.index]: index } : {}) });
        const candidateKey = eachKey(template, candidateScope, index);
        const previous = records.get(candidateKey);
        const scope = previous?.scope ?? candidateScope;
        scope[parsed.item] = item;
        if (parsed.index) scope[parsed.index] = index;
        const key = eachKey(template, scope, index);
        const record = previous ?? { element: cloneEachTemplate(template), scope, key };
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
  });
  bindings<HTMLElement>("[data-tr-text]").forEach(element => {
    if (bindingAlreadyHydrated(element, "text")) return;
    const expression = element.dataset.trText!;
    effect(() => { element.textContent = String(readPath(reactiveState, expression) ?? ""); });
  });
  bindings<HTMLElement>("[data-tr-show]").forEach(element => {
    if (bindingAlreadyHydrated(element, "show")) return;
    const expression = element.dataset.trShow!;
    effect(() => { element.hidden = !Boolean(readPath(reactiveState, expression)); });
  });
  bindings<HTMLElement>("[data-tr-attr]").forEach(element => {
    if (bindingAlreadyHydrated(element, "attr")) return;
    const expression = element.dataset.trAttr!;
    effect(() => {
      const values = readDynamicObject(reactiveState, expression);
      if (!values || typeof values !== "object") return;
      Object.entries(values).forEach(([name, value]) => {
        if (value == null || value === false) element.removeAttribute(name);
        else element.setAttribute(name, value === true ? "" : String(value));
      });
    });
  });
  bindings<HTMLElement>("[data-tr-class]").forEach(element => {
    if (bindingAlreadyHydrated(element, "class")) return;
    const expression = element.dataset.trClass!;
    effect(() => {
      const value = readPath(reactiveState, expression);
      element.className = value && typeof value === "object"
        ? Object.entries(value).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name).join(" ")
        : String(value ?? "");
    });
  });
  bindings<HTMLElement>("[data-tr-style]").forEach(element => {
    if (bindingAlreadyHydrated(element, "style")) return;
    const expression = element.dataset.trStyle!;
    effect(() => {
      const value = readPath(reactiveState, expression);
      const style = element.style;
      if (!value || typeof value !== "object") { element.removeAttribute("style"); return; }
      Array.from(style).forEach(name => style.removeProperty(name));
      Object.entries(value).forEach(([name, next]) => { if (next != null) style.setProperty(name, String(next)); });
    });
  });
  bindings<HTMLElement>("[data-tr-if]").forEach(element => {
    if (bindingAlreadyHydrated(element, "if")) return;
    const expression = element.dataset.trIf!;
    const parent = element.parentNode;
    if (!parent) return;
    const anchor = document.createComment("tr-if");
    parent.insertBefore(anchor, element);
    effect(() => {
      if (readPath(reactiveState, expression)) {
        if (element.parentNode !== parent) parent.insertBefore(element, anchor.nextSibling);
      } else if (element.parentNode === parent) {
        parent.removeChild(element);
      }
    });
  });
  bindings<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-tr-model]").forEach(element => {
    if (bindingAlreadyHydrated(element, "model")) return;
    const expression = element.dataset.trModel!;
    effect(() => { if (element.value !== String(readPath(reactiveState, expression) ?? "")) element.value = String(readPath(reactiveState, expression) ?? ""); });
    element.addEventListener("input", () => writePath(reactiveState, expression, element.value));
  });
  bindings<HTMLElement>("[data-tr-on]").forEach(element => {
    if (bindingAlreadyHydrated(element, "on")) return;
    const [event, name] = (element.dataset.trOn ?? "").split(":", 2);
    const handler = handlers[name];
    if (event && handler) element.addEventListener(event, handler.bind(null, reactiveState));
  });
  return reactiveState;
}
