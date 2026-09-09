# Vue Parity Audit (对照 vue-core 3.6.0-rc.6)

Systematic comparison of the public API surface and semantics against
`vuejs/core` at `v3.6.0-rc.6` (`packages/runtime-core`, `packages/runtime-dom`,
`packages/compiler-sfc`). Last audited: 2026-09-08.

Sources compared:

- Vue: `packages/runtime-core/src/index.ts` export blocks (271 exported names),
  `components/BaseTransition.ts`, `components/Transition.ts`,
  `components/KeepAlive.ts`, `apiCreateApp.ts`, `apiSetupHelpers.ts`,
  `hmr.ts`, `compiler-sfc/src/compileStyle.ts`.
- Ours: `thymeleaf-reactive-runtime/src/index.ts` exports, the SFC compiler,
  and the e2e harness.

## Closed (aligned)

| Area | Status |
| --- | --- |
| Reactivity: `ref`/`reactive`/`computed`/`customRef`/`shallow*`/`readonly`/effect scopes, Vue 3.6 dep tracking | ✅ |
| Watchers: multi-source/deep/immediate/once/flush, `WatchHandle` pause-resume, `onWatcherCleanup` | ✅ |
| Scheduler: `SchedulerJobFlags`, dedup, parent-before-child, recursion limit, post-flush | ✅ |
| VDOM: keyed diff, fragments, SVG namespaces, event arrays/options, class/style normalization | ✅ |
| Component model: props/attrs/emits contracts, slots (scoped/named/dynamic), provide/inject, lifecycle, `onErrorCaptured` | ✅ |
| `defineExpose`/`expose()` public-instance contract; component refs closed when exposed | ✅ |
| `useSlots`/`useAttrs` setup helpers (cached setup context) | ✅ |
| App context: `app.component`/`directive`/`provide`/`use`, chainable, SFC global resolution | ✅ |
| `Teleport`, `KeepAlive` (LRU `max`), `Suspense` (nested + SSR fallback), `Transition` (+`out-in`/`in-out`), `TransitionGroup` | ✅ |
| Async components: `import()` modules, timeout, `onError(retry, fail, attempts)` | ✅ |
| Directives: `withDirectives` full lifecycle, SFC `v-*` with args/modifiers | ✅ |
| SFC `<style>`: `scoped` (`data-v-*` stamping, selector rewriting, `:deep()`, `@media` recursion), `:global()`, `<style module>` (`$style` mapping) | ✅ |
| SFC script setup subset: `defineProps`/`withDefaults`/`defineEmits`/`defineModel`/`defineOptions`/`defineExpose`/`useSlots`/`useAttrs` | ✅ |
| SFC builtin component resolution: `transition`, `transition-group`, `keep-alive`, `teleport`, `suspense` | ✅ |
| HMR: component-level over SSE, template-only state-preserving swaps, script rebuilds, KeepAlive cache transfer | ✅ |
| KeepAlive `include`/`exclude` (string lists, RegExp, arrays) in addition to `max` | ✅ (0.1.x) |
| `Transition appear` (boolean + object hook overrides) | ✅ (0.1.x) |
| API parity batch: `getCurrentInstance`, `hasInjectionContext`, `useId`, `useTemplateRef` (decoupled key), `resolveComponent`, `resolveDirective`, `toDisplayString`, `toHandlerKey`, `normalizeClass`/`normalizeStyle` exports, `camelize`/`capitalize` | ✅ (0.1.x) |
| Release engineering: versions finalized, LICENSE, CHANGELOG, maven-publish, npm publish metadata, real-browser e2e | ✅ |

## Remaining gaps (prioritized)

### P1 — closed this cycle

1. **`Transition appear` object form end-to-end**: covered by the `/tabs`
   browser scenario (hook-override semantics asserted through real Chrome).
2. **`onRenderTracked` / `onRenderTriggered`**: implemented via
   `onTrack`/`onTrigger` effect options and `DebuggerEvent` payloads on the
   property-get/set and ref tracks/triggers.
3. **`useModel`**: standalone helper with getter/setter transforms writing
   through declared-emits listeners.

### P1 — closed

**Mount-time template ref re-render**: fixed with Vue's shape — template-ref
writes are deferred to the post-flush queue (`setVNodeRef` queues the write),
and SFC ref handlers are now STABLE per (scope, name) via
`stableSfcRefHandler`, so patch never re-fires a ref write just because the
closure identity changed. The previously skipped repro test is green. The
investigation also surfaced a latent crash (the component scheduler closure
capturing a not-yet-assigned binding) that is now avoided by keeping the
scheduler closures free of the effect binding.

### P2 — closed this cycle

- **`createRenderer(host)`**: custom renderer entry — node creation goes
  through a `RendererHost` (merged over the default DOM host) for rendering
  into other documents (iframes, popups, stub documents); insertion/removal
  stays on the container nodes.
- **`useCssModule`**: works in SFC script setup via per-instance module
  registries.
- **`:slotted()` selector** in scoped styles: slot outlets stamp passed
  content with the `<scopeId>-s` attribute.
- **`app.onUnmount(callback)`** and **`app.config.errorHandler`** (consulted
  after the `onErrorCaptured` chain; `return false` suppresses default
  logging).
- **`createHydrationRenderer(host)`**: hydration-host parity — same host API
  as `createRenderer` plus a scoped `hydrateRender` entry.
- **`useCssModule` in object components**: via the options-style
  `__cssModules` mapping on the component definition (SFC `$style`/name
  registries unchanged).

### P2 — closed (verified against the compiler source)

**`<style module>` naming**: Vue's compiler-sfc delegates class naming to
`postcss-modules` and leaves the final format to the bundler (Vite appends
`_<filehash>`). Our `<name>_<base36(source hash)>` follows the same
`name_hash` convention with a stable per-file hash, so this item closes as
"verified, no compiler-level format to match". Sharing compiled CSS with Vue
builds remains out of scope by design.

### Deferred with findings — lazy hydration strategies

`hydrateOnIdle` / `hydrateOnVisible` / `hydrateOnInteraction` /
`hydrateOnMediaQuery` (Vue 3.5 naming) were implemented and pass their
strategy-level tests, but wiring them into `hydrate()` exposed a
re-entrancy issue: invoking the full hydration pass from inside a strategy
callback (an interaction listener or the deferred hydrate call) hangs the
subsequent update of the hydrated component. The recursion limiter
correctly stops the loop, but the feature is deferred until the hydration
pass gets a queued-entry design (one hydration job per flush, re-entrancy
guarded) instead of a direct call from strategy callbacks. Strategy
primitives and tests are preserved in history for that round.

### P3 — accepted subset boundaries

9. `@keyframes` names stay unscoped in scoped CSS (no scoping of keyframe
   identifiers); `:global()` accepts single simple selectors only.
10. `openBlock`/`createBlock` structured-diff optimization: our patcher diffs
    children directly; blocks are a perf optimization we may adopt later.
11. `withCtx`/`withScopeId`/`pushScopeId`/`popScopeId` compiled slot helpers.
12. `hydrateOnIdle`/`hydrateOnVisible`/`hydrateOnInteraction`/
    `hydrateOnMediaQuery` lazy-hydration strategies.
13. `onServerPrefetch`, `useSSRContext`, `ssrContextKey`: server-rendering
    runtime APIs (we hydrate Thymeleaf-rendered HTML instead of rendering).
14. `registerRuntimeCompiler`, `isRuntimeOnly` semantics (we bundle a
    CSP-safe compiler by design), `initCustomFormatter`, devtools hooks.
15. `defineComponent` TS generics: our definition is a runtime registry entry;
    type-level `EmitsOptions` inference is approximated, not identical.

### Known behavioral notes (documented divergences)

- A template ref assigned during the initial render does not schedule a
  second render by itself; the value appears on the next render trigger.
  Vue re-renders once after mount in the same situation. (Ref: scheduler
  in-effect recursion timing; tracked for P1.)
- `normalizeStyle` keeps object keys as authored (no camelCase→kebab-case
  rewriting); Vue rewrites keys for style properties.
- `resolveComponent`/`resolveDirective` follow Vue: usable in render() and
  setup(); outside both, `resolveComponent` warns and returns the name
  string (native-tag fallback) and `resolveDirective` warns and returns
  undefined.

## Verification

- Runtime: `npm test` (226 tests green as of this audit).
- Browser: `e2e/` real-Chrome SSE HMR regression (2 scenarios green,
  including in-place template hot swaps and script rebuilds).
- Build: `./gradlew.bat test`.
