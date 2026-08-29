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

The SFC template compiler supports HTML, interpolation, `v-if`/`v-else-if`/`v-else`, `v-show`, `v-for` (including `(item, index) in items` and `of` syntax), `v-text`, `v-model`, `:prop`/`v-bind`, `@event`/`v-on` (including `method()` calls), and `<slot>`. The browser registers `components/Counter.vue` against the `counter` root name, so the server's file-based HMR event remains component-scoped even when filenames and rendered component names differ.

Resource SFCs can use a CSP-safe `<script setup>` subset without evaluating arbitrary JavaScript: `ref(initial)`, `reactive(initial)`, `computed(() => expression)`, and zero-argument methods composed of assignments, increments/decrements, and `emit("event", value)`. Refs are automatically unwrapped in templates and `v-model`. Unsupported statements fail explicitly instead of being evaluated dynamically.

Reactive lists can be rendered on the server with `tr:each`; repeated rows should use `tr:key` so HMR can preserve and move the corresponding DOM nodes:

```html
<li tr:each="item in items" tr:key="item.id">
  <span tr:text="item.label">Item</span>
</li>
```

The first response keeps the server-rendered rows. During browser hydration, those rows are adopted as the initial keyed list rather than rendered a second time, then continue to update when the component state changes.

For `tr:if` and `tr:show`, a false server value is emitted with the HTML `hidden` attribute and reactive metadata. That keeps the first paint hidden without JavaScript while preserving the DOM necessary for the browser runtime to reveal the block later.

`tr:model` supports text fields, checkboxes (including array values), radio groups, and multiple selects. The runtime preserves their current values while patching a component during HMR.

Reactive binding expressions support safe member access plus common arithmetic, comparison, logical, and conditional operators. For example, `tr:text="count + 1"` and `tr:if="count > 0 && visible"` render consistently on the server and update in the browser.

The browser runtime also exports `computed(() => ...)` for cached derived state when authoring render-function components.

## Component API

Alongside function components, the runtime supports object components with `setup`, `render`, `mounted`, `updated`, and `unmounted`. `setup` receives reactive props plus an `emit` function, and can use `ref`, `computed`, `watch`, `provide`, `inject`, `onMounted`, `onUpdated`, and `onUnmounted` to keep local component state and coordinate with ancestor components. `watch` accepts a getter, ref, or reactive object, supports `immediate` and `deep`, and returns a stop function. `proxyRefs` automatically unwraps refs for render-oriented scopes.

```js
const Counter = {
  setup(props, { emit }) {
    const count = ref(0);
    provide("theme", "dark");
    return () => h("button", { onClick: () => emit("save", ++count.value) }, count.value);
  }
};
```

## Virtual DOM Teleport

The render-function runtime exports `Teleport` for rendering a VNode subtree into a different DOM target while retaining keyed updates and component state. Its `to` property accepts a CSS selector or an `Element`.

```js
import { Teleport, h } from "@thymeleaf-reactive/runtime";

const modal = h(Teleport, { to: "#modal-root" }, [
  h("section", { class: "dialog" }, "Saved")
]);
```

Changing `to` moves the existing teleported DOM range to the new target instead of recreating it.

## License

Apache-2.0
