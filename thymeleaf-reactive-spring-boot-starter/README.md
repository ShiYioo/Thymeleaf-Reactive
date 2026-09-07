# Thymeleaf Reactive Spring Boot Starter

Spring Boot auto-configuration for Thymeleaf Reactive: the `tr:*` reactive
dialect, browser runtime asset injection, template watching, and an SSE HMR
transport. Everything below is implemented; there are no planned-only sections.

## What the auto-configuration registers

- `ReactiveDialect` — the `tr:component`, `tr:state`, `tr:text`, `tr:model`,
  `tr:if`, `tr:each`, `tr:on`, and `tr:html` dialect processors.
- `ReactiveRuntimeInjectionFilter` — in development mode, injects
  `<script type="importmap">{"imports":{"jsep":"/thymeleaf-reactive/jsep.js"}}</script>` plus
  `<script type="module" src="{runtimePath}?t=...">` right before the closing
  `</body>` of every `text/html` response (unless the page already references
  the runtime). The import map resolves the runtime's bare `jsep` dependency
  to the vendored copy served next to the bundle. It also sends
  `Cache-Control: no-store` for the runtime asset paths.
- `RuntimeController` — serves `/__thymeleaf_reactive__/bootstrap.js` and the
  bundled browser runtime under `/thymeleaf-reactive/`.
- `HmrController` — the HMR transport (see below).
- `VueComponentController` — serves resource SFCs from the configured template
  directory as cache-busted ES modules (see below).
- `TemplateChangeBroadcaster` — watches the template directory and publishes
  change events.

## HMR transport: Server-Sent Events

The development channel is **Server-Sent Events**, not WebSocket:

- `GET /__thymeleaf_reactive__/events` — an SSE stream. Every template change
  is broadcast as a JSON message `{ path, kind, version, component, moduleUrl }`
  to all connected emitters.
- `GET /__thymeleaf_reactive__/status?since=<version>` — JSON status and
  change history for clients that reconnect: `{ version, changes, lastChange,
  historyComplete, clients }`. If the browser's polled history is incomplete it
  falls back to a full page reload, so no change is ever silently lost.

The browser side ships as `connectHmr()` / `connectComponentHmr()` in the
runtime package: the SSE stream is the fast path, and a versioned poll of
`/status` (every `pollIntervalMillis`, 500 ms by default) recovers anything
missed while the stream was down.

Template files are watched with the JVM `WatchService` when
`template-path` points at a `file:` directory; the same directory is also
registered as the highest-priority Thymeleaf resolver, so edits render on the
next request immediately. `classpath:` layouts use a periodic poll instead.
Change events are debounced (`debounceMillis`, 150 ms by default) and kept in a
bounded history (`hmrHistorySize`, 128 by default).

Saving a `*.vue` file under the template directory resolves the rendered
component name (from `tr:component` / `data-tr-component` in the page templates
or `componentMappings`) and serves a fresh module URL, so the browser hot-swaps
the component's render function while preserving mounted state. Saving a
Thymeleaf template re-renders the page server-side and the browser refreshes
the `tr:*` component bindings.

## Resource SFC modules

`tr:component-src="components/Counter.vue"` makes the browser import
`/__thymeleaf_reactive__/component?path=components/Counter.vue`, which the
starter serves as:

```js
import { compileSfcComponent } from '/thymeleaf-reactive/index.js';
export default compileSfcComponent("<the current file contents>");
```

The SFC is compiled in the browser by the same CSP-safe subset used elsewhere;
no build step or Node toolchain is required in the webapp.

## Configuration

`thymeleaf.reactive.*` properties (`ReactiveProperties`):

| Property | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch for the whole integration. |
| `developmentMode` | `true` | Enables bootstrap injection, SSE HMR, and SFC module serving. Turn off in production. |
| `template-path` | `classpath:/templates` | Template directory. Use `file:src/main/resources/templates` in dev to enable `WatchService` watching. |
| `runtime-path` | `/__thymeleaf_reactive__/bootstrap.js` | Script URL used for injection. |
| `debounce-millis` | `150` | Template-save debounce window. |
| `poll-interval-millis` | `500` | Browser `/status` polling interval. |
| `hmr-history-size` | `128` | Change history kept for reconnecting clients. |
| `component-mappings` | empty | Explicit `path → component name` overrides for SFC HMR. |

## Usage

Use the reactive dialect in a Thymeleaf page:

```html
<section tr:component="counter" tr:state="${counter}">
  <strong tr:text="count"></strong>
  <input tr:model="count">
  <button tr:on="click:increment">+</button>
</section>
```

Or adopt a resource SFC while keeping the server-rendered first paint:

```html
<main tr:component="counter" tr:component-src="components/Counter.vue" tr:state="${counter}">
  <h1>Counter</h1>
  <p tr:text="count">0</p>
</main>
```

`tr:state` accepts JSON directly or a simple server model reference such as
`${counter}`. The latter is serialized with the application `ObjectMapper`.
`tr:on="click:handler"` invokes `handler(state, event)` and accepts Vue-style
event modifiers such as `.prevent`, `.stop`, `.self`, `.once`, keyboard, mouse,
and system modifiers.

In development the bootstrap script is injected automatically; no script tag is
required. The injected bootstrap hydrates the `tr:*` bindings first (so the
server-rendered markup is interactive even if an SFC fails to load) and then
upgrades every `tr:component-src` root to its SFC component.
