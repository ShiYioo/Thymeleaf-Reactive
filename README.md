# Thymeleaf Reactive

A Vue-inspired reactive runtime for Thymeleaf applications.

The project is intentionally split into a browser runtime, a Thymeleaf compiler, and a Spring Boot starter. The first milestone proves the core invariant: changing reactive state patches only the affected DOM nodes.

## Milestone 1

- `thymeleaf-reactive-runtime`: dependency-tracked state, virtual DOM, keyed patching, and declarative event bindings.
- `thymeleaf-reactive-compiler`: translates reactive template bindings into runtime metadata.
- `thymeleaf-reactive-spring-boot-starter`: provides Spring Boot auto-configuration, browser bootstrap injection, template watching, and SSE HMR transport.

## Build baseline

- JDK 25
- Spring Boot 4.1.1
- Kotlin 2.4.10
- Gradle 9.7.1 via the checked-in Wrapper

Build with the checked-in Gradle Wrapper:

```powershell
./gradlew.bat test
```

## Example

Run the counter application with JDK 25:

```powershell
./gradlew.bat :examples:counter:bootRun
```

Then open `http://localhost:8080`. The template is watched directly from
`examples/counter/src/main/resources/templates`; changes to a `tr:component`
are fetched and patched in place during development.

Development HMR transport is exposed at `/__thymeleaf_reactive__/events` as an SSE stream. The browser Runtime will consume this stream and trigger component recompilation/patching.

In development mode the starter injects `/__thymeleaf_reactive__/bootstrap.js` into HTML responses automatically. No script tag is required. Set `thymeleaf.reactive.template-path` to a `file:` directory and the starter uses that same directory as the highest-priority Thymeleaf resolver, so edits are rendered immediately as well as watched. Template save events are debounced by 150 ms by default and can be configured:

```properties
thymeleaf.reactive.debounce-millis=150
thymeleaf.reactive.poll-interval-millis=500
thymeleaf.reactive.hmr-history-size=128
thymeleaf.reactive.component-mappings.admin/dashboard.html=dashboard
```

`component-mappings` accepts template paths relative to `thymeleaf.reactive.template-path`; without an explicit mapping, the HTML file name is used as the component name.
The development status endpoint retains the latest `hmr-history-size` template changes, so the browser polling fallback can replay every missed update in order when an SSE connection is interrupted.

## Resource Vue Components

In development mode, a template component can opt into a resource-backed Vue SFC with `tr:component-src`. The file is resolved relative to `thymeleaf.reactive.template-path`; saving it emits an HMR event, the browser fetches a cache-busted ES module, and only matching component roots are patched.

```html
<section tr:component="counter" tr:component-src="components/Counter.vue" tr:state="${counter}">
  <p tr:text="count">0</p>
</section>
```

The SFC template compiler supports HTML, interpolation, `v-if`/`v-else-if`/`v-else`, `v-show`, `v-for` (including `(item, index) in items` and `of` syntax), `v-text`, `v-html`, `v-model`, static and dynamic `:prop`/`v-bind` arguments, static and dynamic `@event`/`v-on` arguments (including `method()` calls and `.prevent`, `.stop`, `.self`, `.once`, keyboard, mouse-button, and system modifiers), and default or named `<slot>` content with fallbacks. Named slot content can use `v-slot:name`, `#name`, or `slot="name"`. `v-html` assigns trusted HTML directly and should not receive untrusted user input. The browser registers `components/Counter.vue` against the `counter` root name, so the server's file-based HMR event remains component-scoped even when filenames and rendered component names differ.

Resource SFCs can use a CSP-safe `<script setup>` subset without evaluating arbitrary JavaScript: `ref(initial)`, `reactive(initial)`, `computed(() => expression)`, and zero-argument methods composed of assignments, increments/decrements, and `emit("event", value)`. Refs are automatically unwrapped in templates and `v-model`. Template-only HMR updates preserve existing script-setup local state, including components adopted from the server-rendered first paint; a changed script setup rebuilds the component so its new setup logic takes effect. Unsupported statements fail explicitly instead of being evaluated dynamically.

SFC templates support `v-once` for instance-local static subtrees. The subtree is created once and reused across reactive updates, while a template-only HMR replacement clears the cache so the new template is rendered immediately.

Reactive lists can be rendered on the server with `tr:each`; repeated rows should use `tr:key` so HMR can preserve and move the corresponding DOM nodes:

```html
<li tr:each="item in items" tr:key="item.id">
  <span tr:text="item.label">Item</span>
</li>
```

The first response keeps the server-rendered rows. During browser hydration, those rows are adopted as the initial keyed list rather than rendered a second time, then continue to update when the component state changes.

For `tr:if` and `tr:show`, a false server value is emitted with the HTML `hidden` attribute and reactive metadata. That keeps the first paint hidden without JavaScript while preserving the DOM necessary for the browser runtime to reveal the block later.

`tr:model` supports text fields, checkboxes (including array values), radio groups, and multiple selects. `tr:html` and SFC `v-html` assign trusted HTML directly and must not receive untrusted user input. SFC `v-model` additionally supports `.trim`, `.number`, and `.lazy` modifiers. The runtime preserves their current values while patching a component during HMR.

Reactive binding expressions support safe member access plus common arithmetic, comparison, logical, and conditional operators. For example, `tr:text="count + 1"` and `tr:if="count > 0 && visible"` render consistently on the server and update in the browser. During hydration, dynamic attribute bindings reconcile both additions and removals, so a stale server attribute cannot survive a later client-state update.

The browser runtime also exports `computed(() => ...)` for cached derived state when authoring render-function components. `shallowRef()` tracks only replacement of its value and `triggerRef()` can explicitly notify dependents after a deliberate deep mutation, which is useful for large state objects. `watch` accepts a getter, ref, reactive object, or an array of sources such as `watch([userId, () => route.name], callback)`. It supports `immediate`, `deep`, `once`, and explicit `flush: "sync"`, `flush: "pre"`, and `flush: "post"` scheduling; queued watchers are deduplicated and run around the component render queue. `watchEffect()` accepts the same flush options, with `watchSyncEffect()` and `watchPostEffect()` as convenience APIs.

State mutations are also coalescible through synchronous batches (Vue 3.5's `batch` design): effects triggered between `startBatch()` and `endBatch()` run once with the final values instead of once per mutation. Batches nest, and effects with a scheduler still flush through their scheduler when the outermost batch ends.

```js
import { startBatch, endBatch } from "@thymeleaf-reactive/runtime";

startBatch();
state.count = state.count + 1;
state.label = "saved";
state.dirty = false;
endBatch(); // dependents run exactly once, seeing all final values
```

The reactivity API also includes Vue-compatible guards and helpers: `isShallow()` distinguishes shallow proxies and shallow refs, `isProxy()` detects reactive/readonly proxies (but not refs), `toValue()` unwraps a ref or calls a getter, `customRef((track, trigger) => ({ get, set }))` builds refs with explicit dependency control, and `getCurrentScope()` returns the active `effectScope()` when called inside one.

## Component API

Alongside function components, the runtime supports object components with `setup`, `render`, `props`, `emits`, `inheritAttrs`, `beforeMount`, `mounted`, `beforeUpdate`, `updated`, `beforeUnmount`, `unmounted`, `activated`, and `deactivated`. Declared props are reactive, declared event listeners are available through `emit()`, and undeclared attributes are exposed as reactive `attrs` and fall through to a single-root native element unless `inheritAttrs` is `false`. `setup` receives reactive props plus `attrs`, `emit`, and lazy `slots` functions (`slots.default()` or `slots.header()`). Render-function children can use `h("strong", { slot: "header" }, "Title")` for named slots. Slots stay connected to the latest parent children while the component instance and its local state are preserved. `setup` can use `ref`, `computed`, `watch`, `provide`, `inject`, `onBeforeMount`, `onMounted`, `onBeforeUpdate`, `onUpdated`, `onBeforeUnmount`, `onUnmounted`, `onActivated`, and `onDeactivated` to keep local component state and coordinate with ancestor components. `watch` accepts a getter, ref, or reactive object, supports `immediate` and `deep`, and returns a stop function. `proxyRefs` automatically unwraps refs for render-oriented scopes. `effectScope()` and `onScopeDispose()` group effects and cleanup callbacks; object components create one scope per instance and stop it on unmount. Explicit `watch` flush modes are `sync`, `pre`, and `post`; queued watchers are deduplicated around component rendering.

```js
const Counter = {
  setup(props, { emit }) {
    const count = ref(0);
    provide("theme", "dark");
    return () => h("button", { onClick: () => emit("save", ++count.value) }, count.value);
  }
};
```

Object component `props` also accepts Vue-style option objects with `type`, `required`, and `default`. Default factories run once per component instance, Boolean props default to `false`, and undeclared values remain available through `attrs`. `emits` accepts an event-name array or an object of event validators; kebab-case events map to camel-case listeners such as `onSaveItem`. `setup` can also register `onErrorCaptured`, which receives descendant render and lifecycle errors and can return `true` to stop propagation while retaining the last successful tree. Watch and `watchEffect` callbacks may use `onWatcherCleanup()` synchronously to register invalidation cleanup without threading the callback argument through a composable.

## Virtual DOM Teleport

The render-function runtime exports `Teleport` for rendering a VNode subtree into a different DOM target while retaining keyed updates and component state. Its `to` property accepts a CSS selector or an `Element`.

```js
import { Teleport, h } from "@thymeleaf-reactive/runtime";

const modal = h(Teleport, { to: "#modal-root" }, [
  h("section", { class: "dialog" }, "Saved")
]);
```

Changing `to` moves the existing teleported DOM range to the new target instead of recreating it.

The VDOM creates `<svg>` roots and descendants in the SVG namespace and patches SVG attributes without replacing existing nodes.

Render-function event props follow Vue's option suffixes: `onClickCapture`, `onClickPassive`, and `onClickOnce` map to native `addEventListener` options and can coexist with other handlers for the same event.

For render-function applications, `hydrateRender(vnode, container)` adopts compatible server-rendered native DOM nodes and object/function component roots, patches their props and descendants, adopts multi-root `Fragment` ranges, hydrates `Teleport` content between its `<!--teleport-->` placeholder and target `<!--/teleport-->` anchor, and adopts a `Suspense` fallback while its async content is pending. It removes stale server nodes and locally replaces structural mismatches. Hydrated component instances retain their scope, lifecycle hooks, and local state for later scheduled updates, including named component HMR replacements. The adopted tree remains registered for later `render()` patches.

## Virtual DOM Suspense

The render-function runtime exports `Suspense` for async component boundaries. Its `fallback` VNode is rendered while a descendant created by `defineAsyncComponent` is pending; once the loader resolves, the fallback is patched into the resolved content in place. `defineAsyncComponent` accepts Vue-compatible `loadingComponent`, `errorComponent`, `delay`, `timeout`, and `onError(error, retry, fail, attempts)` options, so a transient component or HMR module fetch can be retried without discarding the mounted async boundary.

```js
h(Suspense, { fallback: h("p", {}, "Loading") }, [
  h(defineAsyncComponent(() => import("./Panel.js")))
]);
```

## Virtual DOM Transition

The runtime exports `Transition` for single-child enter and leave transitions. It applies the `v-enter-*` and `v-leave-*` class phases and supports `onBeforeEnter`, `onEnter`, `onAfterEnter`, `onBeforeLeave`, `onLeave`, and `onAfterLeave` hooks. Hooks accepting a second argument can complete asynchronously by calling `done`.

```js
h(Transition, { name: "fade" }, [h("p", {}, "Content")]);
```

For keyed lists, `TransitionGroup` keeps the existing keyed diff while applying the same enter and leave hooks to added and removed children. Its `tag` prop selects the container element.

```js
h(TransitionGroup, { tag: "ul", name: "list" }, items.map(item =>
  h("li", { key: item.id }, item.label)
));
```

## Virtual DOM KeepAlive

The render-function runtime exports `KeepAlive` for caching keyed component instances while switching between views. Cached instances leave the active DOM but keep their local state and effect scope; switching back patches and reuses the cached instance. Unmounting `KeepAlive` disposes every cached component normally.

```js
h(KeepAlive, {}, [h(Editor, { key: activeView })]);
```

## License

Apache-2.0
