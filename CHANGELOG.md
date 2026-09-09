# Changelog

All notable changes to Thymeleaf Reactive are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Scoped CSS `:global(...)`: selectors containing `:global()` are emitted
  without the scope attribute, and bare `:global(.x)` compiles to a global
  descendant rule.
- `<style module>` (with optional injection name, e.g.
  `<style module="classes">`): every class is renamed with the file hash and
  the mapping is exposed to templates as `$style` (or the custom name).
- SFC templates resolve Vue builtin component names intrinsically:
  `<transition>`, `<transition-group>`, `<keep-alive>`, `<teleport>`, and
  `<suspense>` no longer need registry entries.
- End-to-end HMR coverage for script changes (setup state rebuild) and for
  KeepAlive/Transition subtrees on the `/tabs` example page: cached branches
  survive toggles and template-only HMR, and a script edit rebuilds the
  component in place.

### Fixed

- Adopted script-setup components re-run their setup when a hot update
  changes the script. Previously the adopted fallback replayed the stale
  render closure, so edited script logic never took effect in the browser.

## [Unreleased]

### Added

- `KeepAlive include` / `exclude` (comma-delimited strings, RegExp, or arrays)
  controlling which named components are cached; excluded children unmount
  instead of deactivating.
- `Transition appear` accepts an object of enter-hook overrides, in addition
  to the boolean form.
- SFC templates resolve builtin components (`transition`, `transition-group`,
  `keep-alive`, `teleport`, `suspense`) intrinsically.
- Scoped CSS `:global(...)` escapes the scope attribute; bare `:global(.x)`
  compiles to a global descendant rule.
- `<style module>` (optional injection name) renames classes with the file
  hash and exposes the mapping to templates as `$style` or the custom name.
- API parity batch: `getCurrentInstance`, `hasInjectionContext`, `useId`,
  `useTemplateRef` (decoupled key registration), `resolveComponent`,
  `resolveDirective`, `toDisplayString`, `toHandlerKey`, exported
  `normalizeClass`/`normalizeStyle`, `capitalize`.
- Systematic Vue-parity audit document (`docs/vue-parity.md`) with the
  remaining prioritized gap list.
- `useModel(props, name, options)` standalone model helper with getter and
  setter transforms, writing through the declared update listener.
- `onRenderTracked` / `onRenderTriggered` render debug hooks backed by
  `onTrack`/`onTrigger` effect options and `DebuggerEvent` payloads.
- `/tabs` e2e now covers the `Transition appear` object form in a real
  browser (hook override semantics asserted).
- `createRenderer(host)`: custom renderer entry routing node creation
  through a `RendererHost` for rendering into other documents; the default
  document renderer is unaffected.
- `app.config.errorHandler`: app-level error handling consulted after the
  `onErrorCaptured` chain; returning `false` suppresses default logging.
- `createHydrationRenderer(host)`: hydration-host parity for the custom
  renderer entry (scoped `hydrateRender` + render/patch/unmount).
- Lazy hydration strategies (Vue 3.5 naming): `hydrateOnIdle`,
  `hydrateOnVisible`, `hydrateOnInteraction`, `hydrateOnMediaQuery`, plus a
  queued hydration entry in the scheduler (one hydration job per root per
  flush, re-entrancy guarded) and declarative `data-tr-hydrate` bootstrap
  support (`visible`, `idle`, `interaction:events`, `media:query`).
- `useCssModule` now also reads options-style `__cssModules` mappings from
  plain object component definitions.
- `resolveComponent`/`resolveDirective` align with Vue: usable in render()
  and setup(), local-before-global resolution, and out-of-context calls warn
  (`resolveComponent` falls back to the name string, `resolveDirective`
  returns undefined).
- `<style module>` naming verified against the compiler source: Vue's
  compiler-sfc delegates class naming to postcss-modules/bundler; ours uses
  the same Vite-style `name_<filehash>` convention.
- **Fixed (P1)**: template ref writes are deferred to the post-flush queue
  with stable per-(scope, name) SFC ref handlers — a ref assigned during the
  initial render now schedules exactly one extra render (Vue semantics), and
  patch no longer re-fires ref writes on every re-render.
- Scoped CSS `:slotted(...)`: passed slot content is stamped with the
  `<scopeId>-s` attribute and `:slotted(.x)` compiles to `.x[<scopeId>-s]`.
- `useCssModule(name)` inside script setup, backed by per-instance module
  registries.
- `app.onUnmount(callback)`: cleanup callbacks executed on `app.unmount()`.

### Fixed

- Adopted script-setup components re-run setup when a hot update changes the
  script (previously the stale render closure kept rendering).

## [0.1.0] - 2026-09-08

First milestone release: a Vue-level reactive runtime natively integrated
with Thymeleaf, shipped as an npm runtime, an npm compiler, and a Spring Boot
starter.

### Reactive core

- Proxy-based `reactive`/`readonly`/`shallow*`/`ref`/`computed`/`customRef`
  with Vue 3.6-aligned dependency tracking (version-counted deps, batch
  coalescing, effect scopes, `onEffectCleanup`, `traverse`, `proxyRefs`).
- `watch`/`watchEffect`/`watchSyncEffect`/`watchPostEffect` with multi-source,
  deep (including Map/Set and symbol keys), `immediate`, numeric `deep`,
  `once`, and `flush` modes; Vue 3.6 `WatchHandle` pause/resume;
  `onWatcherCleanup`; `nextTick` and the `SchedulerJobFlags` job queue.
- Scheduler deduplication, parent-before-child ordering, failed-job isolation,
  post-flush callbacks, and `flushOnAppMount`.

### Virtual DOM and components

- Keyed diffing patcher with fragment ranges, SVG namespaces, event option
  suffixes, class/style normalization, listener arrays, VNode refs, cloning,
  merging, and memoization (`withMemo`, `v-memo`).
- Object components: `setup`, reactive props with Vue-style options and
  default factories, `attrs` fallthrough, emits validation with kebab-case
  normalization, lazy slots, scoped slots, dynamic slots, `provide`/`inject`,
  full lifecycle hooks, and `onErrorCaptured` isolation.
- `Teleport`, `KeepAlive` (LRU `max`, teleported content), `Suspense` with
  nested-boundary isolation and SSR fallback adoption, `Transition` with
  enter/leave hooks, class phases, `mode: out-in`/`in-out`, and
  `TransitionGroup`.
- Async components: loaders returning dynamic `import()` modules, timeout,
  error UI, and the Vue-compatible `onError(retry, fail, attempts)` protocol.
- Directives: `withDirectives` covering the full VNode lifecycle, usable from
  SFC templates with arguments and modifiers.
- Vue-compatible app context: `app.component`, `app.directive`,
  `app.provide`, `app.use`, chainable, with SFC-template global resolution.
- Public-instance contract: `defineExpose()` and setup-context `expose()`;
  template refs see only exposed state; `useSlots()`/`useAttrs()` setup
  helpers, including SFC bindings.

### Thymeleaf integration and hydration

- `hydrate`/`hydrateRender` adopt server-rendered `tr:*` markup, recover from
  structural mismatches, bind conditional blocks, keyed `each` rows, models,
  handlers with modifiers, and `Suspense`/`Teleport`/multi-root fragments.
- Browser bootstrap keeps Thymeleaf hydration interactive while an SFC module
  loads, and upgrades `tr:component-src` roots to SFC components.
- Server component props metadata (`tr:props`) survives hydration.

### SFC compiler (CSP-safe subset)

- `script setup`: `ref`, `reactive`, `computed`, `defineProps`,
  `withDefaults`, `defineEmits`, `defineModel` (with defaults),
  `defineOptions`, `defineExpose`, `useSlots`, `useAttrs`, methods with
  parameters and `$event`, and explicit failures for unsupported statements.
- Templates: `v-if`/`v-else-if`/`v-else`, `v-show`, `v-for` (ranges, object
  aliases, tuple syntax), `v-model` (checkbox/radio/select, modifiers,
  component contracts), `v-on` object bindings, dynamic arguments, event
  modifiers, `v-once`, `v-memo`, static hoisting, named/dynamic/scoped
  slots, string refs, `v-html`, dynamic components, and custom directives.
- `<style>` blocks with `scoped` support: stable `data-v-*` scope ids,
  selector rewriting (pseudo-classes, pseudo-elements, `:deep()`,
  `@media`/`@supports` recursion), and idempotent style injection.

### Hot module replacement

- Component-level HMR over the starter's SSE channel: template-only edits
  hot-swap the render while preserving script-setup state; script edits
  rebuild the component; keyed instances reconcile across reorders.
- Server-rendered roots adopted by SFCs keep Thymeleaf hydration when a
  module fails to load.
- Versioned change history, poll-based recovery, and full-reload fallback
  when history is incomplete.

### Spring Boot starter

- Auto-configuration: `tr:*` dialect, runtime asset injection with import
  map, SSE `/__thymeleaf_reactive__/events` plus `/status` recovery,
  `WatchService` template watching with polling fallback and debouncing,
  cache-busted SFC module serving, and `thymeleaf.reactive.*` properties.

### Release engineering

- Gradle `maven-publish` publication with sources jar and POM metadata;
  artifacts verified via `publishToMavenLocal`; GitHub Packages target
  configured through `github.user`/`github.token` properties.
- npm packages declare `exports`, `files`, `repository`, and
  `publishConfig`; publishing is guarded by `prepublishOnly` tests.
- Real-browser end-to-end regression (`e2e/`, puppeteer-core) covering the
  full SSE HMR loop against the counter example, including in-place hot
  swaps without reload and state preservation. This harness caught and fixed
  the bare `jsep` import that broke the served runtime in browsers.
