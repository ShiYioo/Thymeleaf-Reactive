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

### P1 — next up

1. **Mount-time template ref re-render**: a ref assigned during the initial
   render should schedule one extra render (Vue does). Root cause localized
   with a minimal repro (kept as a skipped test in the suite): the assignment
   runs inside the render effect's own execution, where `triggerEffects`
   self-skips the running effect (`run === active`), so the write never
   reaches the scheduler. Two fix attempts were explored and reverted:
   - `allowRecurse` on component effects caused over-rendering in the
     dedup/scheduler tests (an ALLOW_RECURSE job re-queues on any mid-run
     trigger), and
   - deferring `setVNodeRef` writes to the post-flush queue re-fired the
     per-render ref closures (identity changes every render), producing a
     write ping-pong.
   A correct fix needs Vue's shape: defer template-ref writes to a
   post-flush job with STABLE ref closures (compare by name, not closure
   identity) and keep the scheduler untouched. The scheduler also has a
   latent crash here: the component update scheduler closure captured the
   not-yet-assigned effect binding, so an in-render trigger threw
   `queueJob(undefined)` (silently swallowed by render error handling).

### P2

4. **`createRenderer` / `createHydrationRenderer`**: custom renderer API.
   Requires extracting our patcher behind a node-op interface.
5. **`<style module>` CSS interop**: class hashes are not Vue-compatible
   strings (different hash source); fine internally, matters only for sharing
   compiled CSS with Vue builds.
6. **`useCssModule`**: accessor for module maps in object components (SFC
   `$style` already works in templates).
7. **`:slotted()` selector** in scoped styles.
8. **`app.onUnmount`** and app-level error handlers (`app.config.errorHandler`).

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
- `resolveComponent` reads the active app context during rendering; calls
  outside a render see only the hot-component registry.

## Verification

- Runtime: `npm test` (226 tests green as of this audit).
- Browser: `e2e/` real-Chrome SSE HMR regression (2 scenarios green,
  including in-place template hot swaps and script rebuilds).
- Build: `./gradlew.bat test`.
