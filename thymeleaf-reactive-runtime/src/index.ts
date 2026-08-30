import jsep from "jsep";

type Primitive = string | number | boolean | null | undefined;
type VNodeChild = VNode | Primitive | VNodeChild[];
export type Effect = (() => void) & { stop?: () => void };
type EffectOptions = { lazy?: boolean; scheduler?: () => void };
export type ComponentRender = (props: Record<string, unknown>, children: VNode[]) => VNode;
export type ComponentSlots = Record<string, () => VNode[]>;
export type ComponentContext = {
  children: VNode[];
  slots: ComponentSlots;
  attrs: Record<string, unknown>;
  emit: (event: string, ...args: unknown[]) => void;
};
export type ComponentOptions = {
  props?: string[];
  emits?: string[];
  inheritAttrs?: boolean;
  setup?: (props: Record<string, unknown>, context: ComponentContext) => ComponentRender | void;
  render?: ComponentRender;
  hmrRender?: (scope: Record<string, unknown>, children: VNode[]) => VNode;
  hmrSignature?: string;
  beforeMount?: () => void;
  mounted?: () => void;
  beforeUpdate?: () => void;
  updated?: () => void;
  beforeUnmount?: () => void;
  unmounted?: () => void;
  activated?: () => void;
  deactivated?: () => void;
};
export type Component = ComponentRender | ComponentOptions;
export type RenderFunction = (state: any) => VNode;
export type AsyncComponentOptions = {
  loader: () => Promise<Component>;
  loadingComponent?: Component;
  errorComponent?: Component;
  delay?: number;
  timeout?: number;
};

const effectStack: Effect[] = [];
const proxyCache = new WeakMap<object, object>();
const reactiveProxies = new WeakSet<object>();
const effectDeps = new WeakMap<Effect, Set<Set<Effect>>>();
const effectSchedulers = new WeakMap<Effect, () => void>();
const ITERATE_KEY = Symbol("iterate");
const queuedPreJobs = new Set<() => void>();
const queuedJobs = new Map<() => void, number>();
const queuedPostJobs = new Set<() => void>();
const refValues = new WeakSet<object>();
const refTriggers = new WeakMap<object, () => void>();
let pendingFlush: Promise<void> | undefined;
let activeEffectScope: EffectScope | undefined;
let nextComponentUid = 0;

export class EffectScope {
  active = true;
  readonly effects = new Set<Effect>();
  readonly cleanups = new Set<() => void>();
  readonly parent = activeEffectScope;

  run<T>(fn: () => T): T | undefined {
    if (!this.active) return undefined;
    const previous = activeEffectScope;
    activeEffectScope = this;
    try { return fn(); }
    finally { activeEffectScope = previous; }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.effects.forEach(run => run.stop?.());
    this.effects.clear();
    this.cleanups.forEach(cleanup => cleanup());
    this.cleanups.clear();
  }
}

export function effectScope(): EffectScope {
  return new EffectScope();
}

export function onScopeDispose(cleanup: () => void): void {
  if (!activeEffectScope) throw new Error("onScopeDispose() must be called inside an active effect scope");
  activeEffectScope.cleanups.add(cleanup);
}

function queueJob(job: () => void, order = Number.POSITIVE_INFINITY): void {
  if (!queuedJobs.has(job) || order < queuedJobs.get(job)!) queuedJobs.set(job, order);
  queueFlush();
}

function queuePreJob(job: () => void): void {
  queuedPreJobs.add(job);
  queueFlush();
}

function queuePostJob(job: () => void): void {
  queuedPostJobs.add(job);
  queueFlush();
}

function queueFlush(): void {
  if (pendingFlush) return;
  pendingFlush = Promise.resolve().then(flushJobs);
}

function flushJobs(): void {
  try {
    while (queuedPreJobs.size || queuedJobs.size || queuedPostJobs.size) {
      const preJobs = [...queuedPreJobs];
      queuedPreJobs.clear();
      preJobs.forEach(runScheduledJob);
      const jobs = [...queuedJobs.entries()]
        .sort((left, right) => left[1] - right[1])
        .map(([job]) => job);
      queuedJobs.clear();
      jobs.forEach(runScheduledJob);
      const postJobs = [...queuedPostJobs];
      queuedPostJobs.clear();
      postJobs.forEach(runScheduledJob);
    }
  } finally {
    pendingFlush = undefined;
  }
}

function runScheduledJob(job: () => void): void {
  try { job(); }
  catch (error) { console.error("[thymeleaf-reactive] scheduler job failed", error); }
}

export function nextTick(): Promise<void>;
export function nextTick<T>(callback: () => T | Promise<T>): Promise<T>;
export function nextTick<T>(callback?: () => T | Promise<T>): Promise<void | T> {
  const promise = pendingFlush ?? Promise.resolve();
  return callback ? promise.then(callback) : promise;
}

function isReactiveValue(value: unknown): value is object {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value) || value instanceof Map || value instanceof Set) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function trackEffect(subscribers: Set<Effect>): void {
  const active = effectStack.at(-1);
  if (!active) return;
  subscribers.add(active);
  let tracked = effectDeps.get(active);
  if (!tracked) effectDeps.set(active, tracked = new Set());
  tracked.add(subscribers);
}

function triggerEffects(subscribers: Iterable<Effect>): void {
  const active = effectStack.at(-1);
  [...new Set(subscribers)].forEach(run => {
    if (run === active) return;
    const scheduler = effectSchedulers.get(run);
    if (scheduler) scheduler();
    else run();
  });
}

export function reactive<T extends object>(value: T): T {
  if (reactiveProxies.has(value)) return value;
  if (proxyCache.has(value)) return proxyCache.get(value) as T;
  const deps = new Map<unknown, Set<Effect>>();
  const subscribers = (key: unknown): Set<Effect> => {
    let value = deps.get(key);
    if (!value) deps.set(key, value = new Set());
    return value;
  };
  const triggerCollection = (key?: unknown): void => {
    const triggered = new Set<Effect>(key === undefined ? [] : deps.get(key) ?? []);
    deps.get(ITERATE_KEY)?.forEach(run => triggered.add(run));
    triggerEffects(triggered);
  };
  const proxy = new Proxy(value, {
    get(target, key, receiver) {
      if (target instanceof Map) {
        if (key === "get") return (entry: unknown) => {
          trackEffect(subscribers(entry));
          const result = target.get(entry);
          return isReactiveValue(result) ? reactive(result) : result;
        };
        if (key === "has") return (entry: unknown) => { trackEffect(subscribers(entry)); return target.has(entry); };
        if (key === "set") return (entry: unknown, next: unknown) => {
          const existed = target.has(entry); const previous = target.get(entry); target.set(entry, next);
          if (!existed || !Object.is(previous, next)) triggerCollection(entry);
          return receiver;
        };
        if (key === "delete") return (entry: unknown) => {
          const existed = target.delete(entry); if (existed) triggerCollection(entry); return existed;
        };
        if (key === "clear") return () => { if (target.size) { target.clear(); triggerCollection(); } };
      }
      if (target instanceof Set) {
        if (key === "has") return (entry: unknown) => { trackEffect(subscribers(entry)); return target.has(entry); };
        if (key === "add") return (entry: unknown) => { const existed = target.has(entry); target.add(entry); if (!existed) triggerCollection(entry); return receiver; };
        if (key === "delete") return (entry: unknown) => { const existed = target.delete(entry); if (existed) triggerCollection(entry); return existed; };
        if (key === "clear") return () => { if (target.size) { target.clear(); triggerCollection(); } };
      }
      if ((target instanceof Map || target instanceof Set) && (key === "size" || key === Symbol.iterator || key === "entries" || key === "values" || key === "keys" || key === "forEach")) {
        trackEffect(subscribers(ITERATE_KEY));
        const member = Reflect.get(target, key, target);
        return typeof member === "function" ? member.bind(target) : member;
      }
      trackEffect(subscribers(key));
      const result = Reflect.get(target, key, receiver);
      return isReactiveValue(result) ? reactive(result) : result;
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
        triggerEffects(triggered);
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
        triggerEffects(triggered);
      }
      return ok;
    },
    ownKeys(target) {
      let subscribers = deps.get(ITERATE_KEY);
      if (!subscribers) deps.set(ITERATE_KEY, subscribers = new Set());
      trackEffect(subscribers);
      return Reflect.ownKeys(target);
    }
  });
  proxyCache.set(value, proxy);
  reactiveProxies.add(proxy);
  return proxy as T;
}

export function effect(fn: Effect, options: EffectOptions = {}): Effect {
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
    effectSchedulers.delete(run);
  };
  if (options.scheduler) effectSchedulers.set(run, options.scheduler);
  activeEffectScope?.effects.add(run);
  if (!options.lazy) run();
  return run;
}

export type ComputedRef<T> = { readonly value: T };

export type Ref<T> = { value: T };

function createRef<T>(value: T, shallow: boolean): Ref<T> {
  if (!shallow) {
    const result = reactive({ value });
    refValues.add(result);
    return result;
  }
  const subscribers = new Set<Effect>();
  let current = value;
  const result = {
    get value(): T {
      trackEffect(subscribers);
      return current;
    },
    set value(next: T) {
      if (Object.is(current, next)) return;
      current = next;
      triggerEffects(subscribers);
    }
  };
  refValues.add(result);
  refTriggers.set(result, () => triggerEffects(subscribers));
  return result;
}

/** Creates a reactive scalar container for component state. */
export function ref<T>(value: T): Ref<T> {
  return createRef(value, false);
}

/** Tracks only replacement of the ref value, leaving nested objects untouched. */
export function shallowRef<T>(value: T): Ref<T> {
  return createRef(value, true);
}

/** Manually notifies effects that depend on a shallow ref after deep mutation. */
export function triggerRef<T>(value: Ref<T>): void {
  refTriggers.get(value as object)?.();
}

export function isRef(value: unknown): value is Ref<unknown> {
  return Boolean(value && typeof value === "object" && refValues.has(value));
}

export function unref<T>(value: T | Ref<T>): T {
  return isRef(value) ? value.value as T : value as T;
}

/** Creates a ref that remains linked to one property of a reactive object. */
export function toRef<T extends object, Key extends keyof T>(source: T, key: Key, defaultValue?: T[Key]): Ref<T[Key]> {
  const result = {
    get value(): T[Key] {
      const value = source[key];
      return value === undefined ? defaultValue as T[Key] : value;
    },
    set value(value: T[Key]) {
      source[key] = value;
    }
  };
  refValues.add(result);
  return result;
}

/** Converts every enumerable property of a reactive object into a linked ref. */
export function toRefs<T extends object>(source: T): { [Key in keyof T]: Ref<T[Key]> } {
  const result = (Array.isArray(source) ? new Array(source.length) : {}) as { [Key in keyof T]: Ref<T[Key]> };
  Object.keys(source).forEach(key => {
    (result as Record<string, Ref<unknown>>)[key] = toRef(source, key as keyof T);
  });
  return result;
}

/** Exposes refs as ordinary values while preserving assignments to their value field. */
export function proxyRefs<T extends object>(value: T): T {
  return new Proxy(value, {
    get(target, key, receiver) {
      return unref(Reflect.get(target, key, receiver));
    },
    set(target, key, next, receiver) {
      const previous = Reflect.get(target, key, receiver);
      if (isRef(previous) && !isRef(next)) {
        previous.value = next;
        return true;
      }
      return Reflect.set(target, key, next, receiver);
    }
  });
}

export type WatchSource<T> = (() => T) | Ref<T> | T;
export type WatchOptions = { immediate?: boolean; deep?: boolean; flush?: "sync" | "pre" | "post" };

function traverse(value: unknown, seen = new Set<object>()): unknown {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach(entry => traverse(entry, seen));
  return value;
}

/** Watches a ref, getter, or reactive object and returns a cleanup function. */
export function watch<T>(
  source: WatchSource<T>,
  callback: (value: T, previous: T | undefined, onCleanup: (cleanup: () => void) => void) => void,
  options: WatchOptions = {}
): () => void {
  const getter = typeof source === "function"
    ? source as () => T
    : isRef(source)
      ? () => source.value as T
      : () => source;
  const forceTrigger = !isRef(source) && typeof source === "object";
  let value!: T;
  let previous: T | undefined;
  let cleanup: (() => void) | undefined;
  const runGetter = effect(() => {
    value = getter();
    if (options.deep || (!isRef(source) && typeof source === "object")) traverse(value);
  }, { lazy: true, scheduler: options.flush === "pre" ? () => queuePreJob(job) : options.flush === "post" ? () => queuePostJob(job) : job });
  function job(): void {
    runGetter();
    if (forceTrigger || options.deep || !Object.is(value, previous)) {
      cleanup?.();
      let nextCleanup: (() => void) | undefined;
      callback(value, previous, next => { nextCleanup = next; });
      cleanup = nextCleanup;
      previous = value;
    }
  }
  if (options.immediate) job();
  else {
    runGetter();
    previous = value;
  }
  return () => {
    cleanup?.();
    runGetter.stop?.();
  };
}

/** Runs immediately, tracks every reactive value it reads, and cleans up before reruns. */
export function watchEffect(run: (onCleanup: (cleanup: () => void) => void) => void): () => void {
  let cleanup: (() => void) | undefined;
  const runner = effect(() => {
    cleanup?.();
    cleanup = undefined;
    run(next => { cleanup = next; });
  });
  return () => {
    runner.stop?.();
    cleanup?.();
    cleanup = undefined;
  };
}

type AsyncComponentState = { component?: Component; error?: unknown; loading: boolean; pending: boolean };
const asyncComponentStates = new WeakMap<ComponentRender, AsyncComponentState>();

/** Creates a component that resolves its implementation on demand. */
export function defineAsyncComponent(source: AsyncComponentOptions | (() => Promise<Component>)): ComponentRender {
  const options = typeof source === "function" ? { loader: source } : source;
  const state = reactive<AsyncComponentState>({
    loading: !options.delay,
    pending: true
  });
  let settled = false;
  if (options.delay && options.delay > 0) {
    setTimeout(() => { if (!settled) state.loading = true; }, options.delay);
  }
  if (options.timeout && options.timeout > 0) {
    setTimeout(() => {
      if (!settled) {
        settled = true;
        state.loading = false;
        state.pending = false;
        state.error = new Error(`Async component timed out after ${options.timeout}ms`);
      }
    }, options.timeout);
  }
  void options.loader().then(component => {
    if (settled) return;
    settled = true;
    state.component = component;
    state.loading = false;
    state.pending = false;
  }).catch(error => {
    if (settled) return;
    settled = true;
    state.error = error;
    state.loading = false;
    state.pending = false;
  });
  const component: ComponentRender = (props, children) => {
    if (state.component) return h(state.component, props, children);
    if (state.error && options.errorComponent) return h(options.errorComponent, { ...props, error: state.error }, children);
    if (state.loading && options.loadingComponent) return h(options.loadingComponent, props, children);
    return { type: Comment, props: {}, children: [], el: null, text: "async-component" };
  };
  asyncComponentStates.set(component, state);
  return component;
}

/** Creates a lazily evaluated, cached value that invalidates when its dependencies change. */
export function computed<T>(getter: () => T): ComputedRef<T> {
  let dirty = true;
  let cached: T;
  const subscribers = new Set<Effect>();
  const runner = effect(() => { cached = getter(); }, {
    lazy: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true;
        triggerEffects(subscribers);
      }
    }
  });
  const result = {
    get value(): T {
      trackEffect(subscribers);
      if (dirty) {
        dirty = false;
        runner();
      }
      return cached!;
    }
  };
  refValues.add(result);
  return result;
}

export const Text = Symbol("text");
export const Comment = Symbol("comment");
export const Fragment = Symbol("fragment");
export const Teleport = Symbol("teleport");
export const KeepAlive = Symbol("keep-alive");
export const Suspense = Symbol("suspense");
export const Transition = Symbol("transition");
export const TransitionGroup = Symbol("transition-group");
type ComponentInstance = {
  vnode: VNode;
  tree: VNode;
  update: Effect;
  dispose: () => void;
  props?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
  children?: VNode[];
  render?: HotReloadableRender;
  parent?: ComponentInstance;
  provides?: Record<PropertyKey, unknown>;
  mountedHooks?: (() => void)[];
  beforeMountHooks?: (() => void)[];
  updatedHooks?: (() => void)[];
  beforeUpdateHooks?: (() => void)[];
  unmountedHooks?: (() => void)[];
  beforeUnmountHooks?: (() => void)[];
  activatedHooks?: (() => void)[];
  deactivatedHooks?: (() => void)[];
  isMounted?: boolean;
  uid?: number;
  scope?: EffectScope;
};
type HotReloadableRender = ComponentRender & { hmrUpdate?: (next: ComponentOptions) => boolean };
const componentInstanceStack: ComponentInstance[] = [];
export type VNode = {
  type: string | typeof Text | typeof Comment | typeof Fragment | typeof Teleport | typeof KeepAlive | typeof Suspense | typeof Transition | typeof TransitionGroup | Component;
  props: Record<string, unknown>;
  children: VNode[];
  el: Node | null;
  anchor?: Node | null;
  target?: Node | null;
  key?: string | number;
  component?: VNode;
  instance?: ComponentInstance;
  owner?: ComponentInstance;
  slot?: string;
  cache?: Map<unknown, VNode>;
  activeKey?: unknown;
  text?: string;
};

export function h(type: VNode["type"], props: Record<string, unknown> = {}, children: VNodeChild = []): VNode {
  const values = Array.isArray(children) ? children : [children];
  return {
    type,
    props,
    children: values.filter(value => value !== null && value !== undefined && value !== false).map(normalizeVNode),
    el: null,
    key: props.key as string | number | undefined,
    slot: props.slot as string | undefined
  };
}

function currentComponentInstance(): ComponentInstance | undefined {
  return componentInstanceStack.at(-1);
}

function registerLifecycleHook(name: "beforeMountHooks" | "mountedHooks" | "beforeUpdateHooks" | "updatedHooks" | "beforeUnmountHooks" | "unmountedHooks" | "activatedHooks" | "deactivatedHooks", hook: () => void): void {
  const instance = currentComponentInstance();
  if (!instance) throw new Error("Lifecycle hooks must be registered during component setup");
  instance[name]!.push(hook);
}

export function onMounted(hook: () => void): void {
  registerLifecycleHook("mountedHooks", hook);
}

export function onBeforeMount(hook: () => void): void {
  registerLifecycleHook("beforeMountHooks", hook);
}

export function onUpdated(hook: () => void): void {
  registerLifecycleHook("updatedHooks", hook);
}

export function onBeforeUpdate(hook: () => void): void {
  registerLifecycleHook("beforeUpdateHooks", hook);
}

export function onUnmounted(hook: () => void): void {
  registerLifecycleHook("unmountedHooks", hook);
}

export function onBeforeUnmount(hook: () => void): void {
  registerLifecycleHook("beforeUnmountHooks", hook);
}

export function onActivated(hook: () => void): void {
  registerLifecycleHook("activatedHooks", hook);
}

export function onDeactivated(hook: () => void): void {
  registerLifecycleHook("deactivatedHooks", hook);
}

export function provide(key: PropertyKey, value: unknown): void {
  const instance = currentComponentInstance();
  if (!instance) throw new Error("provide() must be called during component setup");
  instance.provides![key] = value;
}

export function inject<T>(key: PropertyKey, defaultValue?: T | (() => T)): T | undefined {
  const instance = currentComponentInstance();
  if (!instance) throw new Error("inject() must be called during component setup");
  if (key in instance.provides!) return instance.provides![key] as T;
  return typeof defaultValue === "function" ? (defaultValue as () => T)() : defaultValue;
}

function isObjectComponent(type: VNode["type"]): type is ComponentOptions {
  return typeof type === "object" && type !== null;
}

function emitComponentEvent(listeners: Record<string, unknown>, event: string, args: unknown[]): void {
  const listener = listeners[`on${event.slice(0, 1).toUpperCase()}${event.slice(1)}`];
  const candidates = Array.isArray(listener) ? listener : [listener];
  candidates.forEach(candidate => {
    if (typeof candidate === "function") candidate(...args);
  });
}

function attachComponentOwner(vnode: VNode, owner: ComponentInstance): void {
  if (typeof vnode.type === "function" || isObjectComponent(vnode.type)) vnode.owner = owner;
  vnode.children.forEach(child => attachComponentOwner(child, owner));
}

function syncComponentProps(target: Record<string, unknown>, next: Record<string, unknown>): boolean {
  let changed = false;
  Object.keys(target).forEach(key => {
    if (!(key in next)) {
      delete target[key];
      changed = true;
    }
  });
  Object.entries(next).forEach(([key, value]) => {
    if (!Object.is(target[key], value)) {
      target[key] = value;
      changed = true;
    }
  });
  return changed;
}

function isEmitListener(key: string, emits: string[]): boolean {
  if (!key.startsWith("on") || key.length < 3) return false;
  const event = key.slice(2).replace(/^./, letter => letter.toLowerCase());
  return emits.some(name => name === event || name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()) === event);
}

function splitComponentProps(definition: ComponentOptions, source: Record<string, unknown>): { props: Record<string, unknown>; attrs: Record<string, unknown>; listeners: Record<string, unknown> } {
  if (!definition.props) return { props: source, attrs: {}, listeners: source };
  const props: Record<string, unknown> = {};
  const attrs: Record<string, unknown> = {};
  const listeners: Record<string, unknown> = {};
  Object.entries(source).forEach(([key, value]) => {
    if (definition.props!.includes(key)) props[key] = value;
    else if (isEmitListener(key, definition.emits ?? [])) listeners[key] = value;
    else attrs[key] = value;
  });
  return { props, attrs, listeners };
}

function mergeFallthroughProps(tree: VNode, attrs: Record<string, unknown>): VNode {
  if (!Object.keys(attrs).length || typeof tree.type !== "string") return tree;
  const props = { ...tree.props };
  Object.entries(attrs).forEach(([key, value]) => {
    const existing = props[key];
    if (key === "class") props[key] = [existing, value];
    else if (key === "style") props[key] = [existing, value];
    else if (key.startsWith("on") && existing) props[key] = [...(Array.isArray(existing) ? existing : [existing]), ...(Array.isArray(value) ? value : [value])];
    else props[key] = value;
  });
  return { ...tree, props };
}

function componentSlots(instance: ComponentInstance): ComponentSlots {
  return new Proxy({}, {
    get: (_target, name: string | symbol) => typeof name === "string"
      ? () => (instance.children ?? []).filter(child => (child.slot ?? "default") === name)
      : undefined
  }) as ComponentSlots;
}

function invokeComponentHook(vnode: VNode, name: "activatedHooks" | "deactivatedHooks"): void {
  if (isObjectComponent(vnode.type) && vnode.instance) vnode.instance[name]?.forEach(hook => hook());
  else if (vnode.component) invokeComponentHook(vnode.component, name);
}

function renderObjectComponent(instance: ComponentInstance): VNode {
  componentInstanceStack.push(instance);
  try {
    if (!instance.render) {
      const definition = instance.vnode.type as ComponentOptions;
      instance.render = definition.setup?.(instance.props!, {
        children: instance.children!,
        slots: componentSlots(instance),
        attrs: instance.attrs!,
        emit: (event, ...args) => emitComponentEvent(instance.listeners!, event, args)
      }) ?? definition.render;
      if (!instance.render) throw new Error("Component requires setup() or render()");
    }
    const rendered = instance.render(instance.props!, instance.children!);
    const definition = instance.vnode.type as ComponentOptions;
    const tree = definition.inheritAttrs === false ? rendered : mergeFallthroughProps(rendered, instance.attrs!);
    attachComponentOwner(tree, instance);
    return tree;
  } finally {
    componentInstanceStack.pop();
  }
}

function hotUpdateObjectComponent(vnode: VNode, definition: ComponentOptions): boolean {
  if (!isObjectComponent(vnode.type) || !vnode.instance?.render?.hmrUpdate?.(definition)) return false;
  vnode.type = definition;
  vnode.instance.vnode.type = definition;
  vnode.instance.update();
  return true;
}

function interpolateSfcText(value: string, scope: Record<string, unknown>): string {
  return value.replace(/{{\s*([^}]+?)\s*}}/g, (_match, expression: string) =>
    String(readPath(scope, expression) ?? "")
  );
}

function sfcEventPropName(name: string): string {
  return `on${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
}

function resolveSfcDynamicName(name: string, scope: Record<string, unknown>): string {
  const match = name.match(/^\[([\s\S]+)\]$/);
  if (!match) return name;
  const expression = match[1].trim();
  let value = readPath(scope, expression);
  if (value === undefined && /^[A-Za-z_$][\w$]*$/.test(expression)) {
    const key = Object.keys(scope).find(candidate => candidate.toLowerCase() === expression.toLowerCase());
    if (key) value = scope[key];
  }
  return String(value ?? "");
}

function sfcEventHandler(expression: string, scope: Record<string, unknown>, modifiers: string[] = []): ((event: Event) => void) | undefined {
  const wrap = (handler: (event: Event) => void): ((event: Event) => void) =>
    modifiers.length ? sfcEventModifierHandler(handler, modifiers) : handler;
  const normalized = expression.trim();
  const call = normalized.match(/^([A-Za-z_$][\w$]*)\s*\(\s*\)$/);
  if (call) {
    const method = readPath(scope, call[1]);
    return typeof method === "function" ? wrap(() => method.call(scope)) : undefined;
  }
  const callWithValue = normalized.match(/^([A-Za-z_$][\w$]*)\s*\(\s*(.+?)\s*\)$/);
  if (callWithValue) {
    const method = readPath(scope, callWithValue[1]);
    if (typeof method !== "function") return undefined;
    return wrap(event => {
      const argument = callWithValue[2] === "$event" ? event : readPath(scope, callWithValue[2]);
      method.call(scope, argument);
    });
  }
  const method = readPath(scope, normalized);
  if (typeof method !== "function") return undefined;
  return wrap((event: Event) => method.call(scope, event));
}

function sfcEventModifierHandler(handler: (event: Event) => void, modifiers: string[]): (event: Event) => void {
  let called = false;
  return event => {
    if (modifiers.includes("self") && event.target !== event.currentTarget) return;
    const keyboard = event as KeyboardEvent;
    const mouse = event as MouseEvent;
    const keyAliases: Record<string, string[]> = {
      enter: ["Enter"], esc: ["Escape", "Esc"], tab: ["Tab"], delete: ["Delete", "Backspace"],
      space: [" ", "Spacebar"], up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"]
    };
    const keyModifier = "key" in event ? modifiers.find(modifier => keyAliases[modifier]) : undefined;
    if (keyModifier && !keyAliases[keyModifier].includes(keyboard.key)) return;
    const mouseModifier = modifiers.find(modifier => ["left", "middle", "right"].includes(modifier));
    if (mouseModifier && mouse.button !== ({ left: 0, middle: 1, right: 2 } as Record<string, number>)[mouseModifier]) return;
    if (modifiers.includes("ctrl") && !keyboard.ctrlKey) return;
    if (modifiers.includes("shift") && !keyboard.shiftKey) return;
    if (modifiers.includes("alt") && !keyboard.altKey) return;
    if (modifiers.includes("meta") && !keyboard.metaKey) return;
    if (modifiers.includes("exact") && ["ctrl", "shift", "alt", "meta"].some(key => !modifiers.includes(key) && Boolean(keyboard[`${key}Key` as keyof KeyboardEvent]))) return;
    if (modifiers.includes("once") && called) return;
    called = true;
    if (modifiers.includes("prevent")) event.preventDefault();
    if (modifiers.includes("stop")) event.stopPropagation();
    handler(event);
  };
}

function addSfcEventHandler(props: Record<string, unknown>, eventName: string, handler: ((event: Event) => void) | undefined): void {
  if (!handler) return;
  const key = sfcEventPropName(eventName);
  const previous = props[key];
  props[key] = typeof previous === "function"
    ? (event: Event) => { (previous as (event: Event) => void)(event); handler(event); }
    : handler;
}

function resolveSfcComponent(tagName: string, scope: Record<string, unknown>): Component | undefined {
  const name = tagName.toLowerCase();
  if (["html", "head", "body", "div", "span", "p", "section", "main", "header", "footer", "nav", "ul", "ol", "li", "button", "input", "textarea", "select", "option", "form", "label", "a", "img", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "code", "small", "h1", "h2", "h3", "h4", "h5", "h6"].includes(name)) return undefined;
  const pascal = name.replace(/(^|-)([a-z])/g, (_match, _dash, letter) => letter.toUpperCase());
  const registry = scope.components;
  const registryCandidate = registry && typeof registry === "object"
    ? (registry as Record<string, unknown>)[tagName]
      ?? (registry as Record<string, unknown>)[pascal]
      ?? Object.entries(registry as Record<string, unknown>).find(([key]) => key.toLowerCase() === name)?.[1]
    : undefined;
  const candidate = registryCandidate
    ?? scope[tagName]
    ?? scope[pascal];
  return typeof candidate === "function" || (typeof candidate === "object" && candidate !== null)
    ? candidate as Component
    : undefined;
}

export function resolveDynamicComponent(value: unknown): string | Component | typeof Comment {
  if (typeof value === "string" || typeof value === "function" || (typeof value === "object" && value !== null)) {
    return value as string | Component;
  }
  return Comment;
}

type SfcOnceCache = Map<Node, VNode | VNode[]>;
type SfcMemoCache = Map<Node, { dependencies: unknown[]; vnode: VNode | VNode[] }>;

function renderSfcChildren(nodes: Node[], scope: Record<string, unknown>, slots: VNode[], onceCache?: SfcOnceCache, memoCache?: SfcMemoCache): VNode[] {
  const output: VNode[] = [];
  let previousIf = false;
  nodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? "").trim()) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const condition = element.getAttribute("v-if");
      const alternate = element.hasAttribute("v-else");
      const alternateIf = element.getAttribute("v-else-if");
      if (alternate) {
        if (previousIf) {
          previousIf = false;
          return;
        }
        const clone = element.cloneNode(true) as Element;
        clone.removeAttribute("v-else");
        const rendered = renderSfcNode(clone, scope, slots, onceCache, memoCache);
        if (rendered) output.push(...(Array.isArray(rendered) ? rendered : [rendered]));
        previousIf = true;
        return;
      }
      if (alternateIf) {
        if (previousIf) return;
        previousIf = Boolean(readPath(scope, alternateIf));
        if (!previousIf) return;
        const clone = element.cloneNode(true) as Element;
        clone.removeAttribute("v-else-if");
        const rendered = renderSfcNode(clone, scope, slots, onceCache, memoCache);
        if (rendered) output.push(...(Array.isArray(rendered) ? rendered : [rendered]));
        return;
      }
      if (condition) {
        previousIf = Boolean(readPath(scope, condition));
        if (!previousIf) return;
      } else previousIf = false;
    }
    const rendered = renderSfcNode(node, scope, slots, onceCache, memoCache);
    if (rendered) output.push(...(Array.isArray(rendered) ? rendered : [rendered]));
  });
  return output;
}

function renderSfcSlots(nodes: Node[], scope: Record<string, unknown>, slots: VNode[], onceCache?: SfcOnceCache, memoCache?: SfcMemoCache): VNode[] {
  const output: VNode[] = [];
  nodes.forEach(node => {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      const rendered = renderSfcNode(node, scope, slots, onceCache, memoCache);
      if (rendered) output.push(...(Array.isArray(rendered) ? rendered : [rendered]));
      return;
    }
    const element = node as Element;
    const shorthand = Array.from(element.attributes).find(attribute => attribute.name.startsWith("#"));
    const explicit = shorthand?.name.slice(1) || element.getAttribute("v-slot") ||
      Array.from(element.attributes).find(attribute => attribute.name.startsWith("v-slot:"))?.name.slice(7) ||
      element.getAttribute("slot");
    if (!explicit) {
      const rendered = renderSfcNode(node, scope, slots, onceCache, memoCache);
      if (rendered) output.push(...(Array.isArray(rendered) ? rendered : [rendered]));
      return;
    }
    const source = element.tagName.toLowerCase() === "template"
      ? Array.from((element as HTMLTemplateElement).content.childNodes)
      : [(() => {
          const clone = element.cloneNode(true) as Element;
          clone.removeAttribute("slot");
          return clone;
        })()];
    output.push(...renderSfcChildren(source, scope, slots, onceCache, memoCache).map(vnode => ({ ...vnode, slot: explicit })));
  });
  return output;
}

function normalizeSfcModelValue(value: unknown, modifiers: string[]): unknown {
  if (Array.isArray(value)) return value.map(item => normalizeSfcModelValue(item, modifiers));
  let normalized = value;
  if (modifiers.includes("trim") && typeof normalized === "string") normalized = normalized.trim();
  if (modifiers.includes("number") && normalized !== "" && normalized != null) {
    const number = Number(normalized);
    if (!Number.isNaN(number)) normalized = number;
  }
  return normalized;
}

function renderSfcNode(node: Node, scope: Record<string, unknown>, slots: VNode[], onceCache?: SfcOnceCache, memoCache?: SfcMemoCache): VNode | VNode[] | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.trim() ? normalizeVNode(interpolateSfcText(text, scope)) : undefined;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return undefined;
  const element = node as Element;
  if (element.hasAttribute("v-once") && onceCache?.has(node)) return onceCache.get(node);
  const memoExpression = element.getAttribute("v-memo");
  const memoDependencies = memoExpression ? readPath(scope, memoExpression) : undefined;
  const normalizedMemoDependencies = Array.isArray(memoDependencies) ? memoDependencies : [memoDependencies];
  if (memoExpression && memoCache) {
    const previous = memoCache.get(node);
    if (previous && previous.dependencies.length === normalizedMemoDependencies.length && previous.dependencies.every((value, index) => Object.is(value, normalizedMemoDependencies[index]))) {
      return previous.vnode;
    }
  }
  if (element.tagName.toLowerCase() === "slot") {
    const name = element.getAttribute("name") ?? "default";
    const assigned = slots.filter(child => (child.slot ?? "default") === name);
    return h(Fragment, {}, assigned.length ? assigned : renderSfcChildren(Array.from(element.childNodes), scope, slots, onceCache, memoCache));
  }
  const loop = element.getAttribute("v-for");
  if (loop) {
    const match = loop.match(/^\s*\(?\s*([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?\s*\)?\s+(?:in|of)\s+(.+)\s*$/);
    if (!match) return undefined;
    const values = readPath(scope, match[3]);
    const collection = Array.isArray(values) ? values : values && typeof values === "object" ? Object.values(values) : [];
    return collection.flatMap((value, index) => {
      const childScope = Object.assign(Object.create(scope), {
        [match[1]]: value,
        ...(match[2] ? { [match[2]]: index } : {})
      }) as Record<string, unknown>;
      const clone = element.cloneNode(true) as Element;
      clone.removeAttribute("v-for");
      const rendered = renderSfcNode(clone, childScope, slots, onceCache, memoCache);
      return rendered === undefined ? [] : Array.isArray(rendered) ? rendered : [rendered];
    });
  }
  const condition = element.getAttribute("v-if");
  if (condition && !readPath(scope, condition)) return { type: Comment, props: {}, children: [], el: null, text: "v-if" };
  if (element.hasAttribute("v-else") || element.hasAttribute("v-else-if")) return undefined;
  const show = element.getAttribute("v-show");
  const dynamic = element.tagName.toLowerCase() === "component";
  const dynamicSource = element.getAttribute(":is") ?? element.getAttribute("v-bind:is") ?? element.getAttribute("is");

  const props: Record<string, unknown> = {};
  Array.from(element.attributes).forEach(attribute => {
    const { name, value } = attribute;
    if (name === "v-if" || name === "v-else" || name === "v-else-if" || name === "v-show" || name === "v-text" || name === "v-html" || name === "v-memo" || (dynamic && (name === "is" || name === ":is" || name === "v-bind:is"))) return;
    if (name === "v-bind") {
      const bound = readPath(scope, value);
      if (bound && typeof bound === "object") Object.assign(props, bound);
    } else if (name.startsWith(":")) props[resolveSfcDynamicName(name.slice(1), scope)] = readPath(scope, value);
    else if (name.startsWith("v-bind:")) props[resolveSfcDynamicName(name.slice(7), scope)] = readPath(scope, value);
     else if (name.startsWith("@")) {
       const [eventName, ...modifiers] = name.slice(1).split(".");
       addSfcEventHandler(props, resolveSfcDynamicName(eventName, scope), sfcEventHandler(value, scope, modifiers));
     }
     else if (name.startsWith("v-on:")) {
       const [eventName, ...modifiers] = name.slice(5).split(".");
       addSfcEventHandler(props, resolveSfcDynamicName(eventName, scope), sfcEventHandler(value, scope, modifiers));
     }
    else if (name === "v-model" || name.startsWith("v-model.")) {
      const modelModifiers = name.slice("v-model".length).split(".").filter(Boolean);
      const modelPath = value;
      const writeModel = (next: unknown) => writePath(scope, modelPath, normalizeSfcModelValue(next, modelModifiers));
      const inputType = element.tagName.toLowerCase() === "input"
        ? (element.getAttribute("type") ?? "text").toLowerCase()
        : "text";
      const current = readPath(scope, modelPath);
      if (inputType === "checkbox") {
        const option = element.getAttribute("value");
        props.checked = Array.isArray(current) && option != null
          ? current.map(String).includes(option)
          : Boolean(current);
        props.onChange = (event: Event) => {
          const checked = (event.target as HTMLInputElement).checked;
          const currentValue = readPath(scope, modelPath);
          if (Array.isArray(currentValue) && option != null) {
            const values = currentValue.map(String);
             writeModel(checked
               ? values.includes(option) ? values : [...values, option]
               : values.filter(item => item !== option));
           } else writeModel(checked);
        };
      } else if (inputType === "radio") {
        const option = element.getAttribute("value") ?? "";
        props.checked = String(current ?? "") === option;
        props.onChange = (event: Event) => {
           if ((event.target as HTMLInputElement).checked) writeModel(option);
        };
      } else if (element.tagName.toLowerCase() === "select") {
        const select = element as HTMLSelectElement;
        if (select.multiple) {
          const selected = new Set((Array.isArray(current) ? current : []).map(String));
          props.value = current;
          props.onChange = (event: Event) => {
            const target = event.target as HTMLSelectElement;
             writeModel(Array.from(target.selectedOptions).map(option => option.value));
          };
          Array.from(select.options).forEach(optionNode => { optionNode.selected = selected.has(optionNode.value); });
        } else {
          props.value = current;
           props.onChange = (event: Event) => writeModel((event.target as HTMLSelectElement).value);
        }
      } else {
        props.value = current;
        const eventProp = modelModifiers.includes("lazy") ? "onChange" : "onInput";
        props[eventProp] = (event: Event) => writeModel((event.target as HTMLInputElement).value);
      }
    }
    else props[name] = value;
  });
  if (show) props.hidden = !Boolean(readPath(scope, show));
  const type = dynamic
    ? resolveDynamicComponent(dynamicSource && !element.hasAttribute("is") ? readPath(scope, dynamicSource) : dynamicSource)
    : resolveSfcComponent(element.tagName, scope) ?? element.tagName.toLowerCase();
  const resolvedType = typeof type === "string" ? resolveSfcComponent(type, scope) ?? type : type;
  const component = typeof resolvedType === "function" || isObjectComponent(resolvedType);
  const textExpression = element.getAttribute("v-text");
  const htmlExpression = element.getAttribute("v-html");
  if (htmlExpression) props.innerHTML = readPath(scope, htmlExpression) ?? "";
  const children = component
    ? renderSfcSlots(Array.from(element.childNodes), scope, slots, onceCache, memoCache)
    : htmlExpression
      ? []
      : textExpression
      ? [normalizeVNode(String(readPath(scope, textExpression) ?? ""))]
      : renderSfcChildren(Array.from(element.childNodes), scope, slots, onceCache, memoCache);
  if (element.tagName.toLowerCase() === "select" && element.hasAttribute("multiple")) {
    const selected = new Set((Array.isArray(readPath(scope, element.getAttribute("v-model") ?? ""))
      ? readPath(scope, element.getAttribute("v-model") ?? "")
      : []).map(String));
    children.forEach(child => {
      if (child.type === "option") child.props.selected = selected.has(String(child.props.value ?? ""));
    });
  }
  const vnode = h(resolvedType, props, children);
  if (element.hasAttribute("v-once") && onceCache) onceCache.set(node, vnode);
  if (memoExpression && memoCache) memoCache.set(node, { dependencies: normalizedMemoDependencies, vnode });
  return vnode;
}

type SfcSetupBinding = { name: string; kind: "ref" | "reactive" | "computed"; expression: string };
type SfcSetupMethod = { name: string; body: string };

function splitSfcStatements(source: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index++;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") quote = character;
    else if (character === "(" || character === "[" || character === "{") depth++;
    else if (character === ")" || character === "]" || character === "}") depth--;
    else if (character === ";" && depth === 0) {
      const statement = source.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const statement = source.slice(start).trim();
  if (statement) statements.push(statement);
  return statements;
}

function parseSfcSetup(source: string): { bindings: SfcSetupBinding[]; methods: SfcSetupMethod[] } {
  const bindings: SfcSetupBinding[] = [];
  const methods: SfcSetupMethod[] = [];
  const body = source
    .replace(/\/\/.*$/gm, "")
    .replace(/}\s*(?=(?:const|let|function)\b)/g, "};\n")
    .trim();
  if (!body) return { bindings, methods };
  splitSfcStatements(body).forEach(statement => {
    const binding = statement.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(ref|reactive|computed)\(([\s\S]*)\)$/);
    if (binding) {
      const expression = binding[3].trim();
      const computedMatch = expression.match(/^\(\s*\)\s*=>\s*([\s\S]+)$/);
      if (binding[2] === "computed" && !computedMatch) {
        throw new Error(`Unsupported script setup computed declaration: ${statement}`);
      }
      bindings.push({ name: binding[1], kind: binding[2] as SfcSetupBinding["kind"], expression: computedMatch?.[1].trim() ?? expression });
      return;
    }
    const arrow = statement.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*\)\s*=>\s*(?:\{([\s\S]*)\}|([\s\S]+))$/);
    if (arrow) {
      methods.push({ name: arrow[1], body: (arrow[2] ?? arrow[3]).trim() });
      return;
    }
    const method = statement.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(\s*\)\s*\{([\s\S]*)\}$/);
    if (method) {
      methods.push({ name: method[1], body: method[2].trim() });
      return;
    }
    throw new Error(`Unsupported script setup statement: ${statement}`);
  });
  return { bindings, methods };
}

function splitSfcArguments(source: string): string[] {
  const statements = splitSfcStatements(source.replace(/,/g, ";"));
  return statements.length ? statements : source.trim() ? [source.trim()] : [];
}

function runSfcSetupMethod(body: string, scope: Record<string, unknown>, context: ComponentContext): void {
  splitSfcStatements(body).forEach(statement => {
    const increment = statement.match(/^(.+?)(\+\+|--)$/);
    if (increment) {
      const current = readPath(scope, increment[1]);
      writePath(scope, increment[1], Number(current ?? 0) + (increment[2] === "++" ? 1 : -1));
      return;
    }
    const assignment = statement.match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*([\s\S]+)$/);
    if (assignment) {
      writePath(scope, assignment[1], readPath(scope, assignment[2]));
      return;
    }
    const emit = statement.match(/^emit\(\s*(['"])([^'"]+)\1(?:\s*,\s*([\s\S]+))?\s*\)$/);
    if (emit) {
      context.emit(emit[2], ...splitSfcArguments(emit[3] ?? "").map(argument => readPath(scope, argument)));
      return;
    }
    throw new Error(`Unsupported script setup method statement: ${statement}`);
  });
}

function extractSfcBlock(source: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<\\/?${tagName}(?:\\s[^>]*)?>`, "ig");
  const opening = pattern.exec(source);
  if (!opening) return undefined;
  const contentStart = pattern.lastIndex;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match[0].startsWith("</")) depth--;
    else depth++;
    if (!depth) return source.slice(contentStart, match.index);
  }
  return undefined;
}

/**
 * Compiles a resource-backed Vue SFC template plus a CSP-safe script-setup subset.
 * Supported setup declarations are ref(), reactive(), computed(() => expression),
 * and zero-argument methods containing assignments, increments, decrements, or emit().
 */
export function compileSfcComponent(source: string): Component {
  if (typeof document === "undefined") throw new Error("SFC components require a browser document");
  const templateSource = extractSfcBlock(source, "template");
  if (!templateSource) throw new Error("Vue component is missing a <template> block");
  const template = document.createElement("template");
  template.innerHTML = templateSource;
  const roots = Array.from(template.content.childNodes);
  const script = source.match(/<script\s+setup(?:\s[^>]*)?>([\s\S]*?)<\/script>/i)?.[1];
  if (!script) return (props, children) => {
    const scope = props as Record<string, unknown>;
    const nodes = renderSfcChildren(roots, scope, children);
    return nodes.length === 1 ? nodes[0] : h(Fragment, {}, nodes);
  };
  const setup = parseSfcSetup(script);
  const hmrRender = (scope: Record<string, unknown>, children: VNode[], onceCache?: SfcOnceCache, memoCache?: SfcMemoCache) => {
    const nodes = renderSfcChildren(roots, scope, children, onceCache, memoCache);
    return nodes.length === 1 ? nodes[0] : h(Fragment, {}, nodes);
  };
  return {
    hmrRender,
    hmrSignature: script.trim(),
    setup(props, context) {
      const local = Object.create(props) as Record<string, unknown>;
      setup.bindings.forEach(binding => {
        if (binding.kind === "ref") local[binding.name] = ref(readPath(local, binding.expression));
        else if (binding.kind === "reactive") local[binding.name] = reactive(readPath(local, binding.expression) ?? {});
        else local[binding.name] = computed(() => readPath(proxyRefs(local), binding.expression));
      });
      setup.methods.forEach(method => {
        local[method.name] = () => runSfcSetupMethod(method.body, local, context);
      });
      const scope = proxyRefs(local);
      const onceCache: SfcOnceCache = new Map();
      const memoCache: SfcMemoCache = new Map();
      let activeRender = hmrRender;
      const render: HotReloadableRender = (_props, children) => activeRender(scope, children, onceCache, memoCache);
      render.hmrUpdate = next => {
        if (!next.hmrRender || next.hmrSignature !== script.trim()) return false;
        activeRender = next.hmrRender;
        onceCache.clear();
        memoCache.clear();
        return true;
      };
      return render;
    }
  };
}

function normalizeVNode(value: VNodeChild): VNode {
  if (typeof value === "object" && value !== null && "type" in value) return value as VNode;
  if (Array.isArray(value)) return h(Fragment, {}, value);
  return { type: Text, props: {}, children: [], el: null, text: String(value ?? "") };
}

function hasPendingAsync(vnode: VNode): boolean {
  const state = typeof vnode.type === "function" ? asyncComponentStates.get(vnode.type) : undefined;
  return Boolean(state?.pending || vnode.children.some(hasPendingAsync));
}

function suspenseFallback(vnode: VNode): VNode {
  return normalizeVNode(vnode.props.fallback as VNode | Primitive ?? "");
}

function transitionElement(vnode: VNode): Element | null {
  return vnode.el instanceof Element ? vnode.el : null;
}

function childWithTransitionProps(child: VNode, props: Record<string, unknown>): VNode {
  return { ...child, props: { ...child.props, ...props } };
}

function transitionClassName(vnode: VNode): string {
  return String(vnode.props.name ?? "v");
}

function transitionHook(vnode: VNode, name: string, element: Element, done: () => void): void {
  const hook = vnode.props[name];
  if (typeof hook !== "function") {
    done();
    return;
  }
  if (hook.length >= 2) hook(element, done);
  else {
    hook(element);
    done();
  }
}

function transitionEnter(vnode: VNode): void {
  const element = transitionElement(vnode);
  if (!element) return;
  const name = transitionClassName(vnode);
  const from = `${name}-enter-from`;
  const active = `${name}-enter-active`;
  const to = `${name}-enter-to`;
  const finish = () => {
    element.classList.remove(from, active, to);
    const hook = vnode.props.onAfterEnter;
    if (typeof hook === "function") hook(element);
  };
  const before = vnode.props.onBeforeEnter;
  if (typeof before === "function") before(element);
  element.classList.add(from, active);
  setTimeout(() => {
    element.classList.remove(from);
    element.classList.add(to);
    transitionHook(vnode, "onEnter", element, finish);
  }, 0);
}

function transitionLeave(vnode: VNode, done: () => void): void {
  const element = transitionElement(vnode);
  if (!element) {
    done();
    return;
  }
  const name = transitionClassName(vnode);
  const from = `${name}-leave-from`;
  const active = `${name}-leave-active`;
  const to = `${name}-leave-to`;
  const finish = () => {
    element.classList.remove(from, active, to);
    const hook = vnode.props.onAfterLeave;
    if (typeof hook === "function") hook(element);
    done();
  };
  const before = vnode.props.onBeforeLeave;
  if (typeof before === "function") before(element);
  element.classList.add(from, active);
  setTimeout(() => {
    element.classList.remove(from);
    element.classList.add(to);
    transitionHook(vnode, "onLeave", element, finish);
  }, 0);
}

function isTransitionProp(key: string): boolean {
  return key === "tag" || key === "name" || key.startsWith("onBefore") || key.startsWith("onAfter") || key === "onEnter" || key === "onLeave";
}

function transitionGroupElementProps(props: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([key]) => !isTransitionProp(key)));
}

const eventListeners = new WeakMap<Element, Map<string, EventListener>>();
const svgNamespace = "http://www.w3.org/2000/svg";
const componentNames = new WeakMap<Component, string>();
const componentSources = new Map<string, string>();
const booleanAttributes = new Set(["allowfullscreen", "async", "autofocus", "autoplay", "checked", "controls", "defer", "disabled", "formnovalidate", "hidden", "inert", "ismap", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline", "readonly", "required", "reversed", "selected"]);

function normalizeClass(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(normalizeClass).filter(Boolean).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name)
      .join(" ");
  }
  return "";
}

function normalizeStyle(value: unknown): Record<string, unknown> | string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.reduce<Record<string, unknown>>((result, entry) => {
      const normalized = normalizeStyle(entry);
      if (typeof normalized === "string") {
        normalized.split(";").forEach(declaration => {
          const separator = declaration.indexOf(":");
          if (separator > 0) result[declaration.slice(0, separator).trim()] = declaration.slice(separator + 1).trim();
        });
      } else Object.assign(result, normalized);
      return result;
    }, {});
  }
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

function normalizeComponentSource(source: string): string {
  try {
    const url = new URL(source, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    return url.searchParams.get("path") ?? url.pathname;
  } catch {
    return source.split("?")[0];
  }
}

function setProp(el: Element, key: string, value: unknown, previous?: unknown): void {
  if (key === "key") return;
  if (key === "innerHTML") {
    (el as HTMLElement).innerHTML = value == null ? "" : String(value);
    return;
  }
  if (key.startsWith("on")) {
    const event = key.slice(2).toLowerCase();
    const listeners = eventListeners.get(el) ?? new Map<string, EventListener>();
    const registered = listeners.get(event);
    if (registered) el.removeEventListener(event, registered);
    const handlers = Array.isArray(value) ? value.filter(handler => typeof handler === "function") : [value];
    if (handlers.length) {
      const listener = ((eventValue: Event) => {
        handlers.forEach(handler => (handler as EventListener).call(el, eventValue));
      }) as EventListener;
      el.addEventListener(event, listener);
      listeners.set(event, listener);
    } else {
      listeners.delete(event);
    }
    if (listeners.size) eventListeners.set(el, listeners);
    else eventListeners.delete(el);
  } else if (key === "class") {
    const classes = normalizeClass(value);
    if (el.namespaceURI === svgNamespace) el.setAttribute("class", classes);
    else el.className = classes;
  } else if (key === "style") {
    const normalized = normalizeStyle(value);
    const style = (el as HTMLElement).style;
    if (typeof normalized === "string") style.cssText = normalized;
    else {
      const previousStyle = normalizeStyle(previous);
      if (typeof previousStyle === "string") style.cssText = "";
      else Object.keys(previousStyle).forEach(name => {
        if (!(name in normalized)) style.removeProperty(name);
      });
      Object.entries(normalized).forEach(([name, styleValue]) => {
        if (styleValue == null) style.removeProperty(name);
        else style.setProperty(name, String(styleValue));
      });
    }
  } else if (value == null || value === false) el.removeAttribute(key);
  else if (value === true) {
    el.setAttribute(key, "");
    if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = true;
  } else if (value === "" && booleanAttributes.has(key.toLowerCase())) {
    el.setAttribute(key, "");
    if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = true;
  } else if (el.namespaceURI === svgNamespace) el.setAttribute(key, String(value));
  else if (key in el && !key.includes("-")) (el as unknown as Record<string, unknown>)[key] = value;
  else el.setAttribute(key, String(value));
}

function syncMultipleSelect(el: Element, value: unknown): void {
  if (el.tagName.toLowerCase() !== "select" || !(el as HTMLSelectElement).multiple) return;
  const selected = new Set((Array.isArray(value) ? value : []).map(String));
  Array.from((el as HTMLSelectElement).options).forEach(option => {
    option.selected = selected.has(option.value);
  });
}

function resolveTeleportTarget(to: unknown): Element {
  if (to instanceof Element) return to;
  if (typeof to === "string") {
    const target = document.querySelector(to);
    if (target) return target;
  }
  throw new Error("Teleport requires a valid `to` selector or Element target");
}

function keepAliveKey(vnode: VNode): unknown {
  return vnode.key ?? vnode.type;
}

function isSameVNodeType(oldVNode: VNode, newVNode: VNode): boolean {
  return oldVNode.type === newVNode.type && oldVNode.key === newVNode.key;
}

function getSequence(values: number[]): number[] {
  const predecessors = values.slice();
  const result: number[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value === 0) continue;
    const last = result.at(-1);
    if (last === undefined || values[last] < value) {
      predecessors[index] = last ?? -1;
      result.push(index);
      continue;
    }
    let low = 0;
    let high = result.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[result[middle]] < value) low = middle + 1;
      else high = middle;
    }
    if (value < values[result[low]]) {
      predecessors[index] = low > 0 ? result[low - 1] : -1;
      result[low] = index;
    }
  }
  let cursor = result.length;
  let index = result.at(-1);
  while (cursor-- > 0 && index !== undefined) {
    result[cursor] = index;
    index = predecessors[index] === -1 ? undefined : predecessors[index];
  }
  return result;
}

function pruneKeepAliveCache(vnode: VNode, cache: Map<unknown, VNode>, activeKey: unknown, container: Node): void {
  const rawMax = Number(vnode.props.max);
  if (!Number.isFinite(rawMax)) return;
  const max = Math.max(1, Math.floor(rawMax));
  while (cache.size > max) {
    const candidate = [...cache.entries()].find(([key]) => key !== activeKey);
    if (!candidate) return;
    const [key, cached] = candidate;
    cache.delete(key);
    unmount(cached, cached.el?.parentNode ?? container);
  }
}

function detachVNode(vnode: VNode): void {
  if (vnode.type === Fragment) {
    let node = vnode.el;
    while (node) {
      const next = node === vnode.anchor ? null : node.nextSibling;
      node.parentNode?.removeChild(node);
      if (!next) break;
      node = next;
    }
    return;
  }
  if (vnode.el?.parentNode) vnode.el.parentNode.removeChild(vnode.el);
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
  if (vnode.type === Teleport) {
    const placeholder = vnode.el = document.createComment("teleport");
    const target = resolveTeleportTarget(vnode.props.to);
    const targetAnchor = vnode.anchor = document.createComment("/teleport");
    container.insertBefore(placeholder, anchor);
    target.appendChild(targetAnchor);
    vnode.target = target;
    vnode.children.forEach(child => mount(child, target, targetAnchor));
    return vnode;
  }
  if (vnode.type === Suspense) {
    const content = vnode.children[0];
    const active = content && !hasPendingAsync(content) ? content : suspenseFallback(vnode);
    vnode.component = active;
    mount(active, container, anchor);
    vnode.el = active.el;
    vnode.anchor = active.anchor;
    return vnode;
  }
  if (vnode.type === Transition) {
    const child = vnode.children[0] ?? normalizeVNode("");
    vnode.component = child;
    mount(child, container, anchor);
    vnode.el = child.el;
    vnode.anchor = child.anchor;
    transitionEnter(childWithTransitionProps(child, vnode.props));
    return vnode;
  }
  if (vnode.type === TransitionGroup) {
    const group = h(String(vnode.props.tag ?? "div"), transitionGroupElementProps(vnode.props), vnode.children);
    vnode.component = group;
    mount(group, container, anchor);
    vnode.el = group.el;
    vnode.anchor = group.anchor;
    vnode.children.forEach(child => transitionEnter(childWithTransitionProps(child, vnode.props)));
    return vnode;
  }
  if (vnode.type === KeepAlive) {
    vnode.cache = new Map();
    const child = vnode.children[0];
    if (!child) {
      vnode.el = document.createComment("keep-alive");
      container.insertBefore(vnode.el, anchor);
      return vnode;
    }
    vnode.cache.set(keepAliveKey(child), child);
    vnode.activeKey = keepAliveKey(child);
    mount(child, container, anchor);
    invokeComponentHook(child, "activatedHooks");
    vnode.component = child;
    vnode.el = child.el;
    vnode.anchor = child.anchor;
    return vnode;
  }
  if (isObjectComponent(vnode.type)) {
    const definition = vnode.type;
    const instance = {} as ComponentInstance;
    instance.vnode = vnode;
    instance.parent = vnode.owner;
    const inputs = splitComponentProps(definition, vnode.props);
    instance.props = reactive({ ...inputs.props });
    instance.attrs = reactive({ ...inputs.attrs });
    instance.listeners = inputs.listeners;
    instance.children = vnode.children;
    instance.provides = Object.create(instance.parent?.provides ?? null);
    instance.beforeMountHooks = definition.beforeMount ? [definition.beforeMount] : [];
    instance.mountedHooks = definition.mounted ? [definition.mounted] : [];
    instance.beforeUpdateHooks = definition.beforeUpdate ? [definition.beforeUpdate] : [];
    instance.updatedHooks = definition.updated ? [definition.updated] : [];
    instance.beforeUnmountHooks = definition.beforeUnmount ? [definition.beforeUnmount] : [];
    instance.unmountedHooks = definition.unmounted ? [definition.unmounted] : [];
    instance.activatedHooks = definition.activated ? [definition.activated] : [];
    instance.deactivatedHooks = definition.deactivated ? [definition.deactivated] : [];
    instance.isMounted = false;
    instance.uid = nextComponentUid++;
    instance.scope = effectScope();
    let componentUpdate!: Effect;
    componentUpdate = instance.scope.run(() => effect(() => {
      const nextTree = renderObjectComponent(instance);
      if (!instance.isMounted) {
        instance.beforeMountHooks!.forEach(hook => hook());
        mount(nextTree, container, anchor);
        instance.isMounted = true;
        instance.mountedHooks!.forEach(hook => hook());
      } else {
        instance.beforeUpdateHooks!.forEach(hook => hook());
        instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
        instance.updatedHooks!.forEach(hook => hook());
      }
      instance.tree = nextTree;
      instance.vnode.component = nextTree;
      instance.vnode.el = nextTree.el;
      instance.vnode.anchor = nextTree.anchor;
    }, { scheduler: () => queueJob(componentUpdate, instance.uid) }))!;
    instance.update = componentUpdate;
    instance.dispose = () => instance.scope?.stop();
    vnode.instance = instance;
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
        if (isObjectComponent(entry.render) && hotUpdateObjectComponent(instance.tree, entry.render)) {
          current.component = instance.tree;
          current.el = instance.tree.el;
          current.anchor = instance.tree.anchor;
          return;
        }
        const nextTree = typeof entry.render === "function"
          ? entry.render(current.props, current.children)
          : h(entry.render, current.props, current.children);
        instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
        current.component = instance.tree;
        current.el = instance.tree.el;
        current.anchor = instance.tree.anchor;
      };
      const reactiveUpdate = effect(instance.update);
      instance.dispose = () => {
        reactiveUpdate.stop?.();
        entry.instances.delete(reactiveUpdate);
      };
      vnode.instance = instance;
      entry.instances.add(reactiveUpdate);
    }
    return vnode;
  }
  const isSvg = vnode.type === "svg" || (container as Element).namespaceURI === svgNamespace;
  const el = vnode.el = isSvg
    ? document.createElementNS(svgNamespace, vnode.type)
    : document.createElement(vnode.type);
  const deferredValue = vnode.type === "select" && !vnode.props.multiple ? vnode.props.value : undefined;
  Object.entries(vnode.props).forEach(([key, value]) => {
    if (vnode.type === "select" && key === "value") return;
    setProp(el as Element, key, value);
  });
  vnode.children.forEach(child => mount(child, el));
  if (vnode.type === "select" && deferredValue !== undefined) setProp(el as Element, "value", deferredValue);
  if (vnode.type === "select") syncMultipleSelect(el as Element, vnode.props.value);
  container.insertBefore(el, anchor);
  return vnode;
}

function unmount(vnode: VNode, container: Node): void {
  if (isObjectComponent(vnode.type) && vnode.instance) {
    const instance = vnode.instance;
    instance.beforeUnmountHooks!.forEach(hook => hook());
    instance.dispose();
    unmount(instance.tree, container);
    instance.unmountedHooks!.forEach(hook => hook());
    return;
  }
  if (typeof vnode.type === "function") {
    vnode.instance?.dispose();
    if (vnode.component) unmount(vnode.component, container);
    return;
  }
  if (vnode.type === Suspense) {
    if (vnode.component) unmount(vnode.component, container);
    return;
  }
  if (vnode.type === Transition) {
    if (vnode.component) transitionLeave(childWithTransitionProps(vnode.component, vnode.props), () => unmount(vnode.component!, container));
    return;
  }
  if (vnode.type === TransitionGroup) {
    const group = vnode.component;
    const children = group?.children ?? [];
    let remaining = children.length;
    const finish = () => {
      if (remaining > 0) remaining--;
      if (!remaining) {
        children.forEach(child => { if (child.el) unmount(child, group!.el!); });
        if (group?.el?.parentNode === container) container.removeChild(group.el);
      }
    };
    if (!remaining) {
      if (group?.el?.parentNode === container) container.removeChild(group.el);
      return;
    }
    children.forEach(child => transitionLeave(childWithTransitionProps(child, vnode.props), finish));
    return;
  }
  if (vnode.type === KeepAlive) {
    const cache = vnode.cache;
    if (cache) {
      const seen = new Set<VNode>();
      cache.forEach(cached => {
        if (!seen.has(cached)) {
          seen.add(cached);
          unmount(cached, cached.el?.parentNode ?? container);
        }
      });
    } else if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
    return;
  }
  if (vnode.type === Fragment) {
    vnode.children.forEach(child => unmount(child, container));
    if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
    if (vnode.anchor?.parentNode === container) container.removeChild(vnode.anchor);
    return;
  }
  if (vnode.type === Teleport) {
    const target = vnode.target;
    if (target) {
      vnode.children.forEach(child => unmount(child, target));
      if (vnode.anchor?.parentNode === target) target.removeChild(vnode.anchor);
    }
    if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
    return;
  }
  if (vnode.type !== Text && vnode.type !== Comment) vnode.children.forEach(child => unmount(child, vnode.el ?? container));
  if (vnode.el?.parentNode === container) container.removeChild(vnode.el);
}

function moveVNode(vnode: VNode, container: Node, anchor: Node | null): void {
  if (vnode.type === Transition) {
    if (vnode.component) moveVNode(vnode.component, container, anchor);
    return;
  }
  if (vnode.type === TransitionGroup) {
    if (vnode.component) moveVNode(vnode.component, container, anchor);
    return;
  }
  if (vnode.type === Suspense) {
    if (vnode.component) moveVNode(vnode.component, container, anchor);
    return;
  }
  if (vnode.type === Teleport) {
    if (vnode.el) container.insertBefore(vnode.el, anchor);
    return;
  }
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

function patchChildren(
  container: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  endAnchor: Node | null = null,
  transitionProps?: Record<string, unknown>
): void {
  if (oldChildren.some(child => child.key != null) || newChildren.some(child => child.key != null)) {
    patchKeyedChildren(container, oldChildren, newChildren, endAnchor, transitionProps);
    return;
  }
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
    } else {
      mount(next, container, anchor);
      if (transitionProps) transitionEnter(childWithTransitionProps(next, transitionProps));
    }
    anchor = next.el;
  }
  oldKeyed.forEach(({ child }) => {
    if (!used.has(child)) {
      if (transitionProps) transitionLeave(childWithTransitionProps(child, transitionProps), () => unmount(child, container));
      else unmount(child, container);
    }
  });
}

export function patch(oldVNode: VNode | undefined, newVNode: VNode | undefined, container: Node): VNode | null {
  if (!oldVNode && newVNode) return mount(newVNode, container);
  if (oldVNode && !newVNode) { unmount(oldVNode, container); return null; }
  if (!oldVNode || !newVNode) return null;
  if (oldVNode === newVNode) return newVNode;
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
  if (newVNode.type === Teleport) {
    const oldTarget = oldVNode.target;
    const nextTarget = resolveTeleportTarget(newVNode.props.to);
    newVNode.target = nextTarget;
    if (oldTarget !== nextTarget) {
      const targetAnchor = newVNode.anchor = document.createComment("/teleport");
      nextTarget.appendChild(targetAnchor);
      oldVNode.children.forEach(child => moveVNode(child, nextTarget, targetAnchor));
      if (oldTarget && oldVNode.anchor?.parentNode === oldTarget) oldTarget.removeChild(oldVNode.anchor);
    }
    patchChildren(nextTarget, oldVNode.children, newVNode.children, newVNode.anchor ?? null);
    return newVNode;
  }
  if (newVNode.type === Suspense) {
    const content = newVNode.children[0];
    const nextActive = content && !hasPendingAsync(content) ? content : suspenseFallback(newVNode);
    const active = patch(oldVNode.component, nextActive, container) ?? nextActive;
    newVNode.component = active;
    newVNode.el = active.el;
    newVNode.anchor = active.anchor;
    return newVNode;
  }
  if (newVNode.type === Transition) {
    const oldChild = oldVNode.component;
    const nextChild = newVNode.children[0] ?? normalizeVNode("");
    if (oldChild && oldChild.type === nextChild.type && oldChild.key === nextChild.key) {
      newVNode.component = patch(oldChild, nextChild, container) ?? nextChild;
    } else {
      if (nextChild) {
        mount(nextChild, container, oldChild?.el ?? null);
        transitionEnter(childWithTransitionProps(nextChild, newVNode.props));
      }
      if (oldChild) transitionLeave(childWithTransitionProps(oldChild, oldVNode.props), () => unmount(oldChild, container));
      newVNode.component = nextChild;
    }
    newVNode.el = newVNode.component.el;
    newVNode.anchor = newVNode.component.anchor;
    return newVNode;
  }
  if (newVNode.type === TransitionGroup) {
    const oldGroup = oldVNode.component;
    if (!oldGroup) return mount(newVNode, container, oldVNode.el);
    const nextGroup = h(String(newVNode.props.tag ?? "div"), transitionGroupElementProps(newVNode.props), newVNode.children);
    if (oldGroup.type !== nextGroup.type) {
      mount(nextGroup, container, oldGroup.el);
      oldGroup.el && unmount(oldGroup, container);
    } else {
      nextGroup.el = oldGroup.el;
      const element = oldGroup.el as Element;
      Object.keys({ ...oldGroup.props, ...nextGroup.props }).forEach(key => {
        if (oldGroup.props[key] !== nextGroup.props[key]) setProp(element, key, nextGroup.props[key], oldGroup.props[key]);
      });
      patchChildren(element, oldGroup.children, nextGroup.children, null, newVNode.props);
      const nextKeys = new Set(nextGroup.children);
      const leavingAnchor = oldGroup.children
        .find(child => !nextKeys.has(child) && child.el?.parentNode === element)?.el ?? null;
      if (leavingAnchor) {
        nextGroup.children.forEach(child => moveVNode(child, element, leavingAnchor));
      }
    }
    newVNode.component = nextGroup;
    newVNode.el = nextGroup.el;
    newVNode.anchor = nextGroup.anchor;
    return newVNode;
  }
  if (newVNode.type === KeepAlive) {
    const cache = newVNode.cache = oldVNode.cache ?? new Map();
    const oldChild = oldVNode.component;
    const nextChild = newVNode.children[0];
    if (!nextChild) {
      if (oldChild) {
        invokeComponentHook(oldChild, "deactivatedHooks");
        detachVNode(oldChild);
      }
      newVNode.el = oldVNode.el ?? document.createComment("keep-alive");
      if (!oldVNode.el) container.appendChild(newVNode.el);
      newVNode.activeKey = undefined;
      return newVNode;
    }
    const nextKey = keepAliveKey(nextChild);
    const insertionAnchor = oldChild?.anchor?.nextSibling ?? oldChild?.el?.nextSibling ?? null;
    if (oldChild && oldVNode.activeKey !== nextKey) {
      cache.set(oldVNode.activeKey, oldChild);
      invokeComponentHook(oldChild, "deactivatedHooks");
      detachVNode(oldChild);
    }
    const cached = cache.get(nextKey);
    const active = cached
      ? patch(cached, nextChild, container) ?? cached
      : nextChild;
    if (!cached) {
      mount(active, container, insertionAnchor);
      cache.set(nextKey, active);
      invokeComponentHook(active, "activatedHooks");
    } else {
      cache.delete(nextKey);
      cache.set(nextKey, active);
      moveVNode(active, container, insertionAnchor);
      invokeComponentHook(active, "activatedHooks");
    }
    pruneKeepAliveCache(newVNode, cache, nextKey, container);
    newVNode.activeKey = nextKey;
    newVNode.component = active;
    newVNode.el = active.el;
    newVNode.anchor = active.anchor;
    return newVNode;
  }
  if (isObjectComponent(newVNode.type)) {
    const instance = oldVNode.instance;
    if (!instance) return mount(newVNode, container, oldVNode.el);
    newVNode.instance = instance;
    instance.vnode = newVNode;
    instance.children = newVNode.children;
    const inputs = splitComponentProps(newVNode.type, newVNode.props);
    const propsChanged = syncComponentProps(instance.props!, inputs.props);
    const attrsChanged = syncComponentProps(instance.attrs!, inputs.attrs);
    instance.listeners = inputs.listeners;
    if (!propsChanged && !attrsChanged) instance.update();
    newVNode.component = instance.tree;
    newVNode.el = instance.tree.el;
    newVNode.anchor = instance.tree.anchor;
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
    if (element.tagName.toLowerCase() === "select" && key === "value") return;
    if (oldProps[key] !== newVNode.props[key]) setProp(element, key, newVNode.props[key], oldProps[key]);
  });
  patchChildren(element, oldVNode.children, newVNode.children);
  if (element.tagName.toLowerCase() === "select" && !newVNode.props.multiple && oldProps.value !== newVNode.props.value) {
    setProp(element, "value", newVNode.props.value, oldProps.value);
  }
  if (element.tagName.toLowerCase() === "select") syncMultipleSelect(element, newVNode.props.value);
  return newVNode;
}

const renderedTrees = new WeakMap<Node, VNode>();

function hydrateObjectComponent(vnode: VNode, node: Node | null, container: Node): VNode {
  const definition = vnode.type as ComponentOptions;
  const inputs = splitComponentProps(definition, vnode.props);
  const instance = {} as ComponentInstance;
  instance.vnode = vnode;
  instance.parent = vnode.owner;
  instance.props = reactive({ ...inputs.props });
  instance.attrs = reactive({ ...inputs.attrs });
  instance.listeners = inputs.listeners;
  instance.children = vnode.children;
  instance.provides = Object.create(instance.parent?.provides ?? null);
  instance.beforeMountHooks = definition.beforeMount ? [definition.beforeMount] : [];
  instance.mountedHooks = definition.mounted ? [definition.mounted] : [];
  instance.beforeUpdateHooks = definition.beforeUpdate ? [definition.beforeUpdate] : [];
  instance.updatedHooks = definition.updated ? [definition.updated] : [];
  instance.beforeUnmountHooks = definition.beforeUnmount ? [definition.beforeUnmount] : [];
  instance.unmountedHooks = definition.unmounted ? [definition.unmounted] : [];
  instance.activatedHooks = definition.activated ? [definition.activated] : [];
  instance.deactivatedHooks = definition.deactivated ? [definition.deactivated] : [];
  instance.uid = nextComponentUid++;
  instance.scope = effectScope();
  let componentUpdate!: Effect;
  componentUpdate = instance.scope.run(() => effect(() => {
    const nextTree = renderObjectComponent(instance);
    if (!instance.isMounted) {
      instance.beforeMountHooks!.forEach(hook => hook());
      instance.tree = hydrateVNode(nextTree, node, container);
      instance.isMounted = true;
      instance.mountedHooks!.forEach(hook => hook());
    } else {
      instance.beforeUpdateHooks!.forEach(hook => hook());
      instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
      instance.updatedHooks!.forEach(hook => hook());
    }
    vnode.component = instance.tree;
    vnode.el = instance.tree.el;
    vnode.anchor = instance.tree.anchor;
  }, { scheduler: () => queueJob(componentUpdate, instance.uid) }))!;
  instance.update = componentUpdate;
  instance.dispose = () => instance.scope?.stop();
  vnode.instance = instance;
  return vnode;
}

function hydrateFragment(vnode: VNode, node: Node | null, container: Node): VNode {
  const start = vnode.el = document.createComment("fragment");
  container.insertBefore(start, node);
  let cursor = node;
  vnode.children.forEach(child => {
    const hydrated = hydrateVNode(child, cursor, container);
    const end = hydrated.anchor ?? hydrated.el;
    cursor = end?.nextSibling ?? null;
  });
  const end = vnode.anchor = document.createComment("/fragment");
  container.insertBefore(end, cursor);
  while (cursor && cursor !== end) {
    const next = cursor.nextSibling;
    container.removeChild(cursor);
    cursor = next;
  }
  return vnode;
}

function hydrateVNode(vnode: VNode, node: Node | null, container: Node): VNode {
  if (isObjectComponent(vnode.type)) return hydrateObjectComponent(vnode, node, container);
  if (typeof vnode.type === "function") {
    const component = vnode.type(vnode.props, vnode.children);
    vnode.component = hydrateVNode(component, node, container);
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
        if (isObjectComponent(entry.render) && hotUpdateObjectComponent(instance.tree, entry.render)) {
          current.component = instance.tree;
          current.el = instance.tree.el;
          current.anchor = instance.tree.anchor;
          return;
        }
        const nextTree = typeof entry.render === "function"
          ? entry.render(current.props, current.children)
          : h(entry.render, current.props, current.children);
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
  if (vnode.type === Fragment) return hydrateFragment(vnode, node, container);
  if (vnode.type === Text || vnode.type === Comment) {
    if (!node || (vnode.type === Text ? node.nodeType !== Node.TEXT_NODE : node.nodeType !== Node.COMMENT_NODE)) {
      return mount(vnode, container, node);
    }
    vnode.el = node;
    const text = vnode.text ?? "";
    if (node.nodeValue !== text) node.nodeValue = text;
    return vnode;
  }
  if (typeof vnode.type !== "string" || !node || node.nodeType !== Node.ELEMENT_NODE || (node as Element).tagName.toLowerCase() !== vnode.type.toLowerCase()) {
    const mounted = mount(vnode, container, node);
    if (node?.parentNode === container) container.removeChild(node);
    return mounted;
  }
  const element = vnode.el = node;
  const existingProps = Object.fromEntries(Array.from((element as Element).attributes).map(attribute => [attribute.name, attribute.value]));
  Object.keys(existingProps).forEach(key => {
    if (!(key in vnode.props)) setProp(element as Element, key, undefined, existingProps[key]);
  });
  Object.entries(vnode.props).forEach(([key, value]) => {
    if (existingProps[key] !== value) setProp(element as Element, key, value, existingProps[key]);
  });
  const serverChildren = Array.from(element.childNodes);
  vnode.children.forEach((child, index) => hydrateVNode(child, serverChildren[index] ?? null, element));
  serverChildren.slice(vnode.children.length).forEach(child => child.parentNode === element && element.removeChild(child));
  return vnode;
}

/** Hydrates a native VNode tree against existing server-rendered DOM. */
export function hydrateRender(vnode: VNode, container: Node): VNode {
  const current = container.firstChild;
  const hydrated = hydrateVNode(vnode, current, container);
  renderedTrees.set(container, hydrated);
  return hydrated;
}

/** Renders a VNode into a container, retaining the previous tree for subsequent patches. */
export function render(vnode: VNode | null, container: Node): VNode | null {
  const patched = patch(renderedTrees.get(container), vnode ?? undefined, container);
  if (patched) renderedTrees.set(container, patched);
  else renderedTrees.delete(container);
  return patched;
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
      const uid = nextComponentUid++;
      let rootUpdate!: Effect;
      rootUpdate = effect(() => { tree = patch(tree, currentRender(reactiveState), root) ?? undefined; }, {
        scheduler: () => queueJob(rootUpdate, uid)
      });
      rerender = rootUpdate;
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
export function defineComponent(name: string, render: Component): ComponentRender {
  const existing = hotComponents.get(name);
  if (existing) existing.render = render;
  else hotComponents.set(name, { render, instances: new Set() });
  const component: ComponentRender = (props, children) => {
    const entry = hotComponents.get(name);
    const definition = entry?.render ?? render;
    return typeof definition === "function" ? definition(props, children) : h(definition, props, children);
  };
  componentNames.set(component, name);
  return component;
}

/** Associates a resource path with the component name used by the server-rendered root. */
export function registerComponentSource(source: string, name: string): void {
  componentSources.set(normalizeComponentSource(source), name);
}

/** Adopts a server-rendered component root so future SFC HMR updates patch it in place. */
export function adoptComponentRoot(root: Element, component: Component, props: Record<string, unknown> = {}): void {
  const container = root.parentNode;
  if (!container) return;
  const tree = vnodeFromDom(root);
  const name = componentNames.get(component);
  const entry = name ? hotComponents.get(name) : undefined;
  const definition = isObjectComponent(component)
    ? component
    : entry && isObjectComponent(entry.render) ? entry.render : undefined;
  if (definition) {
    const vnode: VNode = { type: definition, props, children: tree.children, el: tree.el, anchor: tree.anchor, component: tree };
    const instance = {} as ComponentInstance;
    instance.vnode = vnode;
    const inputs = splitComponentProps(definition, props);
    instance.props = reactive({ ...inputs.props });
    instance.attrs = reactive({ ...inputs.attrs });
    instance.listeners = inputs.listeners;
    instance.children = vnode.children;
    instance.provides = Object.create(null);
    instance.beforeMountHooks = definition.beforeMount ? [definition.beforeMount] : [];
    instance.mountedHooks = definition.mounted ? [definition.mounted] : [];
    instance.beforeUpdateHooks = definition.beforeUpdate ? [definition.beforeUpdate] : [];
    instance.updatedHooks = definition.updated ? [definition.updated] : [];
    instance.beforeUnmountHooks = definition.beforeUnmount ? [definition.beforeUnmount] : [];
    instance.unmountedHooks = definition.unmounted ? [definition.unmounted] : [];
    instance.activatedHooks = definition.activated ? [definition.activated] : [];
    instance.deactivatedHooks = definition.deactivated ? [definition.deactivated] : [];
    instance.isMounted = false;
    instance.uid = nextComponentUid++;
    instance.tree = tree;
    instance.scope = effectScope();
    let componentUpdate!: Effect;
    componentUpdate = instance.scope.run(() => effect(() => {
      const nextTree = renderObjectComponent(instance);
      if (!instance.isMounted) instance.beforeMountHooks!.forEach(hook => hook());
      else instance.beforeUpdateHooks!.forEach(hook => hook());
      instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
      if (!instance.isMounted) {
        instance.isMounted = true;
        instance.mountedHooks!.forEach(hook => hook());
      } else {
        instance.updatedHooks!.forEach(hook => hook());
      }
      instance.vnode.component = instance.tree;
      instance.vnode.el = instance.tree.el;
      instance.vnode.anchor = instance.tree.anchor;
    }, { scheduler: () => queueJob(componentUpdate, instance.uid) }))!;
    instance.update = componentUpdate;
    const update = () => {
      if (entry && isObjectComponent(entry.render) && hotUpdateObjectComponent(vnode, entry.render)) return;
      instance.update();
    };
    instance.dispose = () => {
      instance.scope?.stop();
      entry?.instances.delete(update);
    };
    vnode.instance = instance;
    entry?.instances.add(update);
    return;
  }
  if (!entry) return;
  const vnode: VNode = { type: component, props, children: tree.children, el: tree.el, anchor: tree.anchor, component: tree };
  const instance = {} as ComponentInstance;
  instance.vnode = vnode;
  instance.tree = tree;
  instance.update = () => {
    const current = instance.vnode;
    if (isObjectComponent(entry.render) && hotUpdateObjectComponent(instance.tree, entry.render)) {
      current.component = instance.tree;
      current.el = instance.tree.el;
      current.anchor = instance.tree.anchor;
      return;
    }
    const nextTree = typeof entry.render === "function"
      ? entry.render(current.props, current.children)
      : h(entry.render, current.props, current.children);
    instance.tree = patch(instance.tree, nextTree, container) ?? instance.tree;
    current.component = instance.tree;
    current.el = instance.tree.el;
    current.anchor = instance.tree.anchor;
  };
  const reactiveUpdate = effect(instance.update);
  instance.dispose = () => {
    reactiveUpdate.stop?.();
    entry.instances.delete(reactiveUpdate);
  };
  vnode.instance = instance;
  entry.instances.add(reactiveUpdate);
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
  let hasEnqueuedChanges = false;
  let stopped = false;
  const applyChange = async (message: HmrMessage) => {
    if (stopped) return;
    const update = message as ComponentHmrMessage;
    if (typeof update.version === "number" && update.version <= seenVersion) return;
    if (!update.component) {
      window.dispatchEvent(new CustomEvent("thymeleaf-reactive:template-change", { detail: update }));
    } else if (!update.moduleUrl) {
      await refreshComponentsFromPage(update.component);
      if (stopped) return;
    } else {
      const moduleUrl = new URL(update.moduleUrl, window.location.origin);
      moduleUrl.searchParams.set("t", String(Date.now()));
      const module = await import(moduleUrl.href);
      if (stopped) return;
      const render = module.default ?? module.render;
      if (typeof render !== "function" && (!render || typeof render !== "object")) {
        throw new Error("HMR module has no component export");
      }
      const source = moduleUrl.searchParams.get("path");
      const target = source ? componentSources.get(normalizeComponentSource(source)) : undefined;
      if (!hotUpdate(target ?? update.component, render)) {
        console.warn(`[thymeleaf-reactive] no mounted component named ${target ?? update.component}`);
      }
    }
    if (typeof update.version === "number") seenVersion = update.version;
  };
  let changeQueue = Promise.resolve();
  const enqueueChange = (message: HmrMessage): Promise<void> => {
    hasEnqueuedChanges = true;
    const work = changeQueue.then(() => applyChange(message));
    changeQueue = work.catch(() => undefined);
    return work;
  };
  const closeEvents = connectHmr(enqueueChange, endpoint);
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const separator = statusEndpoint.includes("?") ? "&" : "?";
      const response = await fetch(`${statusEndpoint}${separator}since=${encodeURIComponent(seenVersion)}`, { cache: "no-store" });
      if (stopped) return;
      if (!response.ok) return;
      const status = await response.json() as {
        version?: number;
        lastChange?: ComponentHmrMessage;
        changes?: ComponentHmrMessage[];
        historyComplete?: boolean;
      };
      const version = status.version ?? 0;
      if (!pollingInitialized) {
        pollingInitialized = true;
        if (!hasEnqueuedChanges) seenVersion = Math.max(seenVersion, version);
        return;
      }
      if (version <= seenVersion) return;
      if (status.historyComplete === false) {
        if (stopped) return;
        console.warn("[thymeleaf-reactive] HMR history is incomplete; reloading the page");
        window.location.reload();
        return;
      }
      const changes = (status.changes?.length ? status.changes : status.lastChange ? [status.lastChange] : [])
        .sort((left, right) => (left.version ?? 0) - (right.version ?? 0));
      if (!changes.length) {
        if (stopped) return;
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
  return () => { stopped = true; closeEvents(); clearInterval(timer); };
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
  scope: EffectScope;
  uid: number;
};
const hydrationContexts = new WeakMap<Element, HydrationContext>();

function disposeHydration(root: Element): void {
  const context = hydrationContexts.get(root);
  if (!context) return;
  [...context.cleanups].reverse().forEach(cleanup => cleanup());
  context.scope.stop();
  hydrationContexts.delete(root);
}

function hydrationEffect(context: HydrationContext, fn: () => void): Effect {
  let runner!: Effect;
  runner = context.scope.run(() => effect(fn as Effect, { scheduler: () => queueJob(runner, context.uid) }))!;
  return runner;
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

function patchKeyedChildren(
  container: Node,
  oldChildren: VNode[],
  newChildren: VNode[],
  endAnchor: Node | null,
  transitionProps?: Record<string, unknown>
): void {
  let oldStart = 0;
  let newStart = 0;
  let oldEnd = oldChildren.length - 1;
  let newEnd = newChildren.length - 1;

  while (oldStart <= oldEnd && newStart <= newEnd && isSameVNodeType(oldChildren[oldStart], newChildren[newStart])) {
    patch(oldChildren[oldStart++], newChildren[newStart++], container);
  }
  while (oldStart <= oldEnd && newStart <= newEnd && isSameVNodeType(oldChildren[oldEnd], newChildren[newEnd])) {
    patch(oldChildren[oldEnd--], newChildren[newEnd--], container);
  }
  if (oldStart > oldEnd) {
    const anchor = newChildren[newEnd + 1]?.el ?? endAnchor;
    while (newStart <= newEnd) mount(newChildren[newStart++], container, anchor);
    return;
  }
  if (newStart > newEnd) {
    while (oldStart <= oldEnd) {
      if (transitionProps) transitionLeave(childWithTransitionProps(oldChildren[oldStart], transitionProps), () => unmount(oldChildren[oldStart], container));
      else unmount(oldChildren[oldStart], container);
      oldStart++;
    }
    return;
  }

  const newIndexByKey = new Map<string | number, number>();
  for (let index = newStart; index <= newEnd; index++) {
    const key = newChildren[index].key;
    if (key != null) newIndexByKey.set(key, index);
  }
  const toBePatched = newEnd - newStart + 1;
  const newIndexToOldIndex = new Array(toBePatched).fill(0);
  let moved = false;
  let maxOldIndex = 0;
  for (let oldIndex = oldStart; oldIndex <= oldEnd; oldIndex++) {
    const oldChild = oldChildren[oldIndex];
    let newIndex = oldChild.key == null ? undefined : newIndexByKey.get(oldChild.key);
    if (newIndex === undefined && oldChild.key == null) {
      for (let candidate = newStart; candidate <= newEnd; candidate++) {
        if (newIndexToOldIndex[candidate - newStart] === 0 && isSameVNodeType(oldChild, newChildren[candidate])) {
          newIndex = candidate;
          break;
        }
      }
    }
    if (newIndex === undefined) {
      if (transitionProps) transitionLeave(childWithTransitionProps(oldChild, transitionProps), () => unmount(oldChild, container));
      else unmount(oldChild, container);
      continue;
    }
    const offset = newIndex - newStart;
    if (newIndexToOldIndex[offset] !== 0) {
      if (transitionProps) transitionLeave(childWithTransitionProps(oldChild, transitionProps), () => unmount(oldChild, container));
      else unmount(oldChild, container);
      continue;
    }
    newIndexToOldIndex[offset] = oldIndex + 1;
    if (newIndex < maxOldIndex) moved = true;
    else maxOldIndex = newIndex;
    patch(oldChild, newChildren[newIndex], container);
  }

  const stable = moved ? getSequence(newIndexToOldIndex) : [];
  let stableIndex = stable.length - 1;
  for (let index = toBePatched - 1; index >= 0; index--) {
    const newIndex = newStart + index;
    const anchor = newChildren[newIndex + 1]?.el ?? endAnchor;
    if (newIndexToOldIndex[index] === 0) {
      mount(newChildren[newIndex], container, anchor);
      if (transitionProps) transitionEnter(childWithTransitionProps(newChildren[newIndex], transitionProps));
    } else if (moved && (stableIndex < 0 || index !== stable[stableIndex])) {
      moveVNode(newChildren[newIndex], container, anchor);
    } else {
      stableIndex--;
    }
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
  liveRoots: Map<HTMLElement, HTMLElement>,
  nextDocument: Document
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
  const nextBody = nextDocument.body;
  const nextParent = nextRoot.parentElement;
  if (!nextParent) return undefined;
  const path: number[] = [];
  let cursor: Element | null = nextParent;
  while (cursor && cursor !== nextBody) {
    const parent: Element | null = cursor.parentElement;
    if (!parent) return undefined;
    const index = Array.from(parent.children).indexOf(cursor);
    if (index < 0) return undefined;
    path.unshift(index);
    cursor = parent;
  }
  if (cursor !== nextBody) return undefined;
  let liveParent: Element = document.body;
  for (const index of path) {
    const child = liveParent.children.item(index);
    if (!child) return undefined;
    liveParent = child;
  }
  return { parent: liveParent, anchor: null };
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
    const insertion = insertionPointForAddedComponent(nextRoot, next, liveRoots, nextDocument);
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
  const context: HydrationContext = { state: reactiveState, handlers, cleanups: new Set(), scope: effectScope(), uid: nextComponentUid++ };
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
    const runner = hydrationEffect(context, () => {
      const collection = readPath(reactiveState, parsed.collection);
      const values = Array.isArray(collection) ? collection : collection && typeof collection === "object" ? Object.values(collection) : [];
      const nextKeys = new Set<string | number>();
      const nextRecords: EachRecord[] = [];
      values.forEach((item, index) => {
        const candidateScope = Object.assign(Object.create(reactiveState), {
          [parsed.item]: item,
          ...(parsed.index ? { [parsed.index]: index } : {})
        });
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
    const runner = hydrationEffect(context, () => { element.textContent = String(readPath(reactiveState, expression) ?? ""); });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-html]").forEach(element => {
    const expression = element.dataset.trHtml!;
    const runner = hydrationEffect(context, () => { element.innerHTML = String(readPath(reactiveState, expression) ?? ""); });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-show]").forEach(element => {
    const expression = element.dataset.trShow!;
    const runner = hydrationEffect(context, () => { element.hidden = !Boolean(readPath(reactiveState, expression)); });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-attr]").forEach(element => {
    const expression = element.dataset.trAttr!;
    const applied = new Set<string>();
    const runner = hydrationEffect(context, () => {
      const values = readDynamicObject(reactiveState, expression);
      const next = values && typeof values === "object" ? values as Record<string, unknown> : {};
      applied.forEach(name => {
        if (!(name in next)) element.removeAttribute(name);
      });
      Object.entries(next).forEach(([name, value]) => {
        if (value == null || value === false) element.removeAttribute(name);
        else element.setAttribute(name, value === true ? "" : String(value));
      });
      applied.clear();
      Object.keys(next).forEach(name => applied.add(name));
    });
    cleanup(() => { runner.stop?.(); applied.clear(); });
  });
  bindings<HTMLElement>("[data-tr-class]").forEach(element => {
    const expression = element.dataset.trClass!;
    const staticClass = element.className;
    const runner = hydrationEffect(context, () => {
      const dynamicClass = normalizeClass(readPath(reactiveState, expression));
      element.className = [staticClass, dynamicClass].filter(Boolean).join(" ");
    });
    cleanup(() => runner.stop?.());
  });
  bindings<HTMLElement>("[data-tr-style]").forEach(element => {
    const expression = element.dataset.trStyle!;
    const staticStyle = element.getAttribute("style") ?? "";
    const dynamicStyleKeys = new Set<string>();
    const runner = hydrationEffect(context, () => {
      const value = normalizeStyle(readPath(reactiveState, expression));
      const style = element.style;
      dynamicStyleKeys.forEach(name => style.removeProperty(name));
      dynamicStyleKeys.clear();
      if (typeof value === "string") {
        element.setAttribute("style", [staticStyle, value].filter(Boolean).join(";"));
        return;
      }
      element.setAttribute("style", staticStyle);
      Object.entries(value).forEach(([name, next]) => {
        if (next != null) {
          style.setProperty(name, String(next));
          dynamicStyleKeys.add(name);
        }
      });
    });
    cleanup(() => { runner.stop?.(); dynamicStyleKeys.clear(); });
  });
  bindings<HTMLElement>("[data-tr-if]").forEach(element => {
    const expression = element.dataset.trIf!;
    const parent = element.parentNode;
    if (!parent) return;
    const anchor = document.createComment("tr-if");
    parent.insertBefore(anchor, element);
    const runner = hydrationEffect(context, () => {
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
    const runner = hydrationEffect(context, () => {
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
    const [eventSpec, name] = (element.dataset.trOn ?? "").split(":", 2);
    const [event, ...modifiers] = eventSpec.split(".");
    const handler = handlers[name];
    if (event && handler) {
      const listener = sfcEventModifierHandler(
        eventObject => handler(reactiveState, eventObject),
        modifiers
      );
      element.addEventListener(event, listener);
      cleanup(() => element.removeEventListener(event, listener));
    }
  });
  return reactiveState;
}
