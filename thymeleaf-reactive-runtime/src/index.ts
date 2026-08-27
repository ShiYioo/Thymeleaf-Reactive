type Primitive = string | number | boolean | null | undefined;
export type Effect = () => void;
export type Component = (props: Record<string, unknown>, children: VNode[]) => VNode;
export type RenderFunction = (state: any) => VNode;

const effectStack: Effect[] = [];
const proxyCache = new WeakMap<object, object>();
const reactiveProxies = new WeakSet<object>();

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
      }
      const result = Reflect.get(target, key, receiver);
      return result && typeof result === 'object' ? reactive(result) : result;
    },
    set(target, key, next, receiver) {
      const changed = !Object.is(Reflect.get(target, key, receiver), next);
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
  reactiveProxies.add(proxy);
  return proxy as T;
}

export function effect(fn: Effect): Effect {
  const run: Effect = () => {
    effectStack.push(run);
    try { fn(); } finally { effectStack.pop(); }
  };
  run();
  return run;
}

export const Text = Symbol("text");
export type VNode = {
  type: string | typeof Text | Component;
  props: Record<string, unknown>;
  children: VNode[];
  el: Node | null;
  key?: string | number;
  component?: VNode;
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

function setProp(el: Element, key: string, value: unknown, previous?: unknown): void {
  if (key === "key") return;
  if (key.startsWith("on") && typeof value === "function") {
    const event = key.slice(2).toLowerCase();
    if (typeof previous === "function") el.removeEventListener(event, previous as EventListener);
    el.addEventListener(event, value as EventListener);
  } else if (value == null || value === false) el.removeAttribute(key);
  else if (value === true) el.setAttribute(key, "");
  else if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = value;
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
    return vnode;
  }
  const el = vnode.el = document.createElement(vnode.type);
  Object.entries(vnode.props).forEach(([key, value]) => setProp(el as Element, key, value));
  vnode.children.forEach(child => mount(child, el));
  container.insertBefore(el, anchor);
  return vnode;
}

function patchChildren(el: Element, oldChildren: VNode[], newChildren: VNode[]): void {
  const oldKeyed = new Map(oldChildren.map((child, index) => [child.key ?? index, { child, index }]));
  let anchor: Node | null = null;
  for (let i = newChildren.length - 1; i >= 0; i--) {
    const next = newChildren[i];
    const identity = next.key ?? i;
    const match = oldKeyed.get(identity);
    if (match) {
      patch(match.child, next, el);
      if (match.index !== i && next.el) el.insertBefore(next.el, anchor);
      oldKeyed.delete(identity);
    } else mount(next, el, anchor);
    anchor = next.el;
  }
  oldKeyed.forEach(({ child }) => child.el && el.removeChild(child.el));
}

export function patch(oldVNode: VNode | undefined, newVNode: VNode | undefined, container: Node): VNode | null {
  if (!oldVNode && newVNode) return mount(newVNode, container);
  if (oldVNode && !newVNode) { if (oldVNode.el) container.removeChild(oldVNode.el); return null; }
  if (!oldVNode || !newVNode) return null;
  if (oldVNode.type !== newVNode.type || oldVNode.key !== newVNode.key) {
    const next = mount(newVNode, container, oldVNode.el);
    if (oldVNode.el) container.removeChild(oldVNode.el);
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
    const nextComponent = newVNode.type(newVNode.props, newVNode.children);
    patch(oldVNode.component, nextComponent, container);
    newVNode.component = nextComponent;
    newVNode.el = nextComponent.el;
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
  let rerender: (() => void) | undefined;
  return {
    mount(root: Element): object {
      let tree: VNode | undefined;
      rerender = effect(() => { tree = patch(tree, currentRender(reactiveState), root) ?? undefined; });
      mountedApps.add(rerender);
      return reactiveState;
    },
    replaceRender(nextRender: (state: any) => VNode): void {
      currentRender = nextRender;
      rerender?.();
    }
  };
}

type HotComponent = { render: Component; instances: Set<() => void> };
const hotComponents = new Map<string, HotComponent>();
const mountedApps = new Set<() => void>();

/** Registers a named component so a compiler can replace its render function in development. */
export function defineComponent(name: string, render: Component): Component {
  const existing = hotComponents.get(name);
  if (existing) existing.render = render;
  else hotComponents.set(name, { render, instances: new Set() });
  const component: Component = (props, children) => {
    const entry = hotComponents.get(name);
    return (entry?.render ?? render)(props, children);
  };
  return component;
}

/** Replaces one component's render function while preserving its mounted DOM/state. */
export function hotUpdate(name: string, render: Component): boolean {
  const entry = hotComponents.get(name);
  if (!entry) return false;
  entry.render = render;
  entry.instances.forEach(update => update());
  mountedApps.forEach(update => update());
  return true;
}

export type HmrMessage = { path: string; kind: string };

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
  endpoint = "/__thymeleaf_reactive__/events"
): () => void {
  return connectHmr(async message => {
    const update = message as ComponentHmrMessage;
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
  }, endpoint);
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
const hydratedBindings = new WeakSet<Element>();

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

/** Hydrates server-rendered Thymeleaf metadata into reactive DOM bindings. */
export function hydrate(root: Element, state: object, handlers: Record<string, (...args: any[]) => any> = {}): object {
  const reactiveState = reactive(state);
  hydrationContexts.set(root, { state: reactiveState, handlers });
  const bindings = <T extends HTMLElement>(selector: string): T[] => [
    ...(root.matches(selector) ? [root as T] : []),
    ...Array.from(root.querySelectorAll<T>(selector))
  ];
  bindings<HTMLElement>("[data-tr-text]").forEach(element => {
    if (hydratedBindings.has(element)) return;
    hydratedBindings.add(element);
    const expression = element.dataset.trText!;
    effect(() => { element.textContent = String(readPath(reactiveState, expression) ?? ""); });
  });
  bindings<HTMLElement>("[data-tr-show]").forEach(element => {
    if (hydratedBindings.has(element)) return;
    hydratedBindings.add(element);
    const expression = element.dataset.trShow!;
    effect(() => { element.hidden = !Boolean(readPath(reactiveState, expression)); });
  });
  bindings<HTMLElement>("[data-tr-if]").forEach(element => {
    if (hydratedBindings.has(element)) return;
    hydratedBindings.add(element);
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
    if (hydratedBindings.has(element)) return;
    hydratedBindings.add(element);
    const expression = element.dataset.trModel!;
    effect(() => { if (element.value !== String(readPath(reactiveState, expression) ?? "")) element.value = String(readPath(reactiveState, expression) ?? ""); });
    element.addEventListener("input", () => writePath(reactiveState, expression, element.value));
  });
  bindings<HTMLElement>("[data-tr-on]").forEach(element => {
    if (hydratedBindings.has(element)) return;
    hydratedBindings.add(element);
    const [event, name] = (element.dataset.trOn ?? "").split(":", 2);
    const handler = handlers[name];
    if (event && handler) element.addEventListener(event, handler.bind(null, reactiveState));
  });
  return reactiveState;
}
