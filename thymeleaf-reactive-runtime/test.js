import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { adoptComponentRoot, reactive, shallowReactive, isReactive, markRaw, readonly, shallowReadonly, isReadonly, ref, shallowRef, triggerRef, effect, computed, compileSfcComponent, connectComponentHmr, createApp, customRef, defineAsyncComponent, defineComponent, effectScope, Fragment, KeepAlive, Suspense, Transition, TransitionGroup, h, hotUpdate, hydrate, hydrateRender, isMemoSame, nextTick, onActivated, onBeforeMount, onBeforeUnmount, onBeforeUpdate, onDeactivated, onEffectCleanup, onErrorCaptured, onScopeDispose, onWatcherCleanup, refreshComponentsFromPage, render, Teleport, inject, isProxy, isRef, isShallow, onMounted, onUnmounted, onUpdated, pauseTracking, enableTracking, resetTracking, provide, proxyRefs, queueJob, queuePostFlushCb, flushOnAppMount, stop, toRaw, toReactive, toReadonly, toRef, toRefs, toValue, traverse, unref, watch, watchEffect, watchPostEffect, watchSyncEffect, withDirectives, withMemo, startBatch, endBatch, getCurrentScope, getCurrentWatcher, SchedulerJobFlags } from './dist/index.js';

function installDom() {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Event = window.Event;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.DOMParser = window.DOMParser;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  return window.document;
}

test('reactive state tracks and reruns dependent effects', () => {
  const state = reactive({ count: 0, other: 1 });
  let runs = 0; let value;
  effect(() => { runs++; value = state.count; });
  state.other++;
  assert.equal(runs, 1);
  state.count++;
  assert.equal(runs, 2);
  assert.equal(value, 1);
});

test('computed values cache work and propagate invalidation to effects', () => {
  const state = reactive({ count: 1 });
  let evaluations = 0;
  const doubled = computed(() => { evaluations++; return state.count * 2; });
  assert.equal(evaluations, 0);
  assert.equal(doubled.value, 2);
  assert.equal(doubled.value, 2);
  assert.equal(evaluations, 1);
  let observed = 0;
  const runner = effect(() => { observed = doubled.value; });
  assert.equal(observed, 2);
  state.count = 2;
  assert.equal(observed, 4);
  assert.equal(evaluations, 2);
  runner.stop();
  state.count = 3;
  assert.equal(evaluations, 2);
  assert.equal(doubled.value, 6);
  assert.equal(evaluations, 3);
});

test('startBatch and endBatch coalesce multiple mutations into one effect run', () => {
  const state = reactive({ count: 0, label: 'a' });
  const seen = [];
  effect(() => { seen.push(`${state.label}:${state.count}`); });
  startBatch();
  state.count = 1;
  state.label = 'b';
  state.count = 2;
  assert.deepEqual(seen, ['a:0']); // queued, not yet run
  endBatch();
  assert.deepEqual(seen, ['a:0', 'b:2']); // ran exactly once, with final values
});

test('startBatch and endBatch nest and flush only at the outermost end', () => {
  const state = reactive({ count: 0 });
  let runs = 0;
  effect(() => { runs++; state.count; });
  startBatch();
  state.count = 1;
  startBatch();
  state.count = 2;
  endBatch();
  assert.equal(runs, 1); // inner end() does not flush
  state.count = 3;
  assert.equal(runs, 1); // still inside the outer batch
  endBatch();
  assert.equal(runs, 2); // single flush after the outermost end()
  assert.equal(state.count, 3);
});

test('batches across effects deduplicate a shared subscriber', () => {
  const state = reactive({ a: 1, b: 2 });
  let leftRuns = 0; let rightRuns = 0; let bothRuns = 0;
  effect(() => { leftRuns++; state.a; });
  effect(() => { rightRuns++; state.b; });
  effect(() => { bothRuns++; state.a; state.b; });
  startBatch();
  state.a = 10;
  state.b = 20;
  endBatch();
  assert.equal(leftRuns, 2);
  assert.equal(rightRuns, 2);
  assert.equal(bothRuns, 2); // one per batch, not one per mutation
});

test('computed values propagate once through a batch', () => {
  const state = reactive({ count: 1 });
  const doubled = computed(() => state.count * 2);
  let observed = 0;
  effect(() => { observed = doubled.value; });
  assert.equal(observed, 2);
  startBatch();
  state.count = 2;
  state.count = 3;
  assert.equal(observed, 2); // not yet flushed
  endBatch();
  assert.equal(observed, 6); // single flush sees the final computed value
  assert.equal(doubled.value, 6);
});

test('scheduled effects flush once through a batch via their scheduler', async () => {
  const state = reactive({ count: 0 });
  let runs = 0;
  const seen = [];
  const job = () => { runs++; seen.push(state.count); };
  effect(job, { scheduler: () => queueMicrotask(job) });
  assert.deepEqual(seen, [0]);
  startBatch();
  state.count = 1;
  state.count = 2;
  endBatch();
  assert.deepEqual(seen, [0]); // scheduler queued, job not run yet
  await nextTick();
  assert.deepEqual(seen, [0, 2]); // one deferred run with the final value
  assert.equal(runs, 2);
});

test('effect pause suspends runs and resume replays one dirty run', () => {
  const state = reactive({ count: 0, label: 'a' });
  const seen = [];
  const runner = effect(() => { seen.push(`${state.label}:${state.count}`); });
  assert.deepEqual(seen, ['a:0']);
  runner.pause();
  state.count = 1;
  state.label = 'b';
  assert.deepEqual(seen, ['a:0']); // paused: no runs
  runner.resume();
  assert.deepEqual(seen, ['a:0', 'b:1']); // one replay with final values
  state.count = 2;
  assert.deepEqual(seen, ['a:0', 'b:1', 'b:2']); // resumed: normal runs
  runner.stop();
});

test('effect resume without pending changes does not rerun', () => {
  const state = reactive({ count: 0 });
  let runs = 0;
  const runner = effect(() => { runs++; state.count; });
  runner.pause();
  runner.resume();
  assert.equal(runs, 1); // no dirty change while paused
  runner.stop();
});

test('paused scheduled effects defer one replay through their scheduler', async () => {
  const state = reactive({ count: 0 });
  const seen = [];
  const runner = effect(() => { seen.push(state.count); }, { scheduler: () => { queueMicrotask(() => { seen.push('job'); runner(); }); } });
  runner.pause();
  state.count = 1;
  state.count = 2;
  await nextTick();
  assert.deepEqual(seen, [0]); // paused: no scheduler job ran
  runner.resume();
  assert.deepEqual(seen, [0]); // resume goes through the scheduler, deferred
  await nextTick();
  assert.deepEqual(seen, [0, 'job', 2]); // one replay with the final value
  runner.stop();
});

test('onEffectCleanup registers per-effect cleanup before reruns and stop', () => {
  const state = reactive({ count: 0 });
  const events = [];
  const runner = effect(() => {
    const current = state.count;
    events.push(`run:${current}`);
    onEffectCleanup(() => events.push(`cleanup:${current}`));
  });
  assert.deepEqual(events, ['run:0']);
  state.count = 1;
  assert.deepEqual(events, ['run:0', 'cleanup:0', 'run:1']);
  state.count = 2;
  assert.deepEqual(events, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2']);
  runner.stop();
  assert.deepEqual(events, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1', 'run:2', 'cleanup:2']);
});

test('onEffectCleanup works inside watch callbacks like onWatcherCleanup', () => {
  const count = ref(0);
  const events = [];
  const stop = watch(count, () => {
    events.push(`watch:${count.value}`);
    onEffectCleanup(() => events.push('cleanup'));
  });
  count.value = 1;
  assert.deepEqual(events, ['watch:1']);
  count.value = 2;
  assert.deepEqual(events, ['watch:1', 'cleanup', 'watch:2']);
  stop();
  assert.deepEqual(events, ['watch:1', 'cleanup', 'watch:2', 'cleanup']);
});

test('getCurrentWatcher returns the running watcher inside watch', () => {
  const count = ref(0);
  let seen = [];
  const stop = watch(count, () => {
    const watcher = getCurrentWatcher();
    assert.notEqual(watcher, undefined);
    assert.equal(typeof watcher.stop, 'function');
    seen.push('watch');
  });
  count.value = 1;
  stop();
  assert.deepEqual(seen, ['watch']);
  assert.equal(getCurrentWatcher(), undefined);
});

test('pauseTracking stops dependency collection until resetTracking', () => {
  const state = reactive({ tracked: 0, untracked: 0 });
  let runs = 0;
  let lastTracked = -1;
  effect(() => {
    runs++;
    lastTracked = state.tracked;
    pauseTracking();
    state.untracked;
    resetTracking();
  });
  assert.equal(runs, 1);
  state.untracked = 5; // read under pauseTracking: not a dependency
  assert.equal(runs, 1);
  assert.equal(lastTracked, 0);
  state.tracked = 1; // still tracked
  assert.equal(runs, 2);
  assert.equal(lastTracked, 1);
});

test('enableTracking re-enables collection even when globally paused', () => {
  const state = reactive({ a: 1, b: 2 });
  let runs = 0;
  let observed = '';
  pauseTracking();
  effect(() => {
    runs++;
    state.a; // should NOT be collected (globally paused)
    enableTracking();
    observed = String(state.b); // IS collected
    resetTracking();
  });
  assert.equal(runs, 1);
  state.a = 10;
  assert.equal(runs, 1); // not a dependency
  state.b = 20;
  assert.equal(runs, 2); // collected via enableTracking
  assert.equal(observed, '20');
  resetTracking(); // undo the initial global pause
});

test('nested pauseTracking and resetTracking restore the previous state', () => {
  const state = reactive({ x: 0 });
  pauseTracking();
  pauseTracking();
  effect(() => { state.x; }); // runs while paused: x not collected
  resetTracking(); // inner: still paused
  resetTracking(); // outer: tracking restored
  let runs = 0;
  effect(() => { runs++; state.x; });
  assert.equal(runs, 1);
  state.x = 1;
  assert.equal(runs, 2);
});

test('watch returns a WatchHandle with pause/resume (Vue 3.6)', () => {
  const count = ref(0);
  const events = [];
  const handle = watch(count, (value) => { events.push(`watch:${value}`); });
  // handle is callable and carries pause/resume
  assert.equal(typeof handle, 'function');
  assert.equal(typeof handle.pause, 'function');
  assert.equal(typeof handle.resume, 'function');
  count.value = 1;
  assert.deepEqual(events, ['watch:1']);
  handle.pause();
  count.value = 2;
  count.value = 3;
  assert.deepEqual(events, ['watch:1']); // paused: no callbacks
  handle.resume();
  assert.deepEqual(events, ['watch:1', 'watch:3']); // one replay with the final value
  count.value = 4;
  assert.deepEqual(events, ['watch:1', 'watch:3', 'watch:4']); // resumed: normal
  handle(); // stop via the handle itself
  count.value = 5;
  assert.deepEqual(events, ['watch:1', 'watch:3', 'watch:4']);
});

test('watch pause with no pending change does not replay on resume', () => {
  const count = ref(0);
  let calls = 0;
  const handle = watch(count, () => { calls++; });
  handle.pause();
  handle.resume();
  assert.equal(calls, 0);
  handle();
});

test('watchEffect returns a WatchHandle with pause/resume (Vue 3.6)', () => {
  const count = ref(0);
  const events = [];
  const handle = watchEffect(() => { events.push(`effect:${count.value}`); });
  assert.equal(typeof handle, 'function');
  assert.equal(typeof handle.pause, 'function');
  assert.equal(typeof handle.resume, 'function');
  assert.deepEqual(events, ['effect:0']);
  handle.pause();
  count.value = 1;
  count.value = 2;
  assert.deepEqual(events, ['effect:0']);
  handle.resume();
  assert.deepEqual(events, ['effect:0', 'effect:2']);
  handle();
  count.value = 3;
  assert.deepEqual(events, ['effect:0', 'effect:2']);
});

test('watchSyncEffect and watchPostEffect handles expose pause/resume', () => {
  const sync = watchSyncEffect(() => {});
  const post = watchPostEffect(() => {});
  assert.equal(typeof sync.pause, 'function');
  assert.equal(typeof sync.resume, 'function');
  assert.equal(typeof post.pause, 'function');
  assert.equal(typeof post.resume, 'function');
  sync();
  post();
});

test('onWatcherCleanup accepts failSilently outside watchers', () => {
  assert.throws(() => onWatcherCleanup(() => {}));
  onWatcherCleanup(() => {}, true); // no throw when failSilently
});

test('watch deep accepts a numeric depth (Vue 3.6)', () => {
  const state = reactive({ root: 0, a: { b: { c: 1 } } });
  let rootCalls = 0;
  const w1 = watch(() => state, () => { rootCalls++; }, { deep: 1 });
  assert.equal(rootCalls, 0);
  state.root = 1;        // root property: within depth 1
  assert.equal(rootCalls, 1);
  state.a.b.c = 99;      // 3 levels deep: beyond depth 1
  assert.equal(rootCalls, 1);
  w1();

  let twoCalls = 0;
  const w2 = watch(() => state, () => { twoCalls++; }, { deep: 2 });
  state.a.b = { c: 5 };  // level-2 property: within depth 2
  assert.equal(twoCalls, 1);
  state.a.b.c = 7;       // level-3 property: beyond depth 2
  assert.equal(twoCalls, 1);
  w2();
});

test('watch deep true still traverses all levels', () => {
  const state = reactive({ a: { b: { c: 1 } } });
  let calls = 0;
  const w = watch(() => state, () => { calls++; }, { deep: true });
  state.a.b.c = 42;
  assert.equal(calls, 1);
  w();
});

test('watch deep 0 or false limits to root properties of a reactive source', () => {
  const state = reactive({ root: 0, a: { b: 1 } });
  let zeroCalls = 0;
  const w0 = watch(state, () => { zeroCalls++; }, { deep: 0 });
  state.root = 2;
  assert.equal(zeroCalls, 1);
  state.a.b = 3;
  assert.equal(zeroCalls, 1);
  w0();

  let falseCalls = 0;
  const wf = watch(state, () => { falseCalls++; }, { deep: false });
  state.root = 4;
  assert.equal(falseCalls, 1);
  state.a.b = 5;
  assert.equal(falseCalls, 1);
  wf();
});

test('toReactive and toReadonly wrap objects and pass through non-objects (Vue 3.6)', () => {
  const raw = { n: 1 };
  const r = toReactive(raw);
  assert.equal(isReactive(r), true);
  assert.notEqual(r, raw);
  assert.equal(isReactive(toReactive(r)), true); // already wrapped: same cache
  assert.equal(isReadonly(toReactive(toReadonly(raw))), true); // reactive wraps underlying readonly target? -> creates reactive over readonly raw; still works
  assert.equal(toReactive(5), 5);
  assert.equal(toReactive(null), null);
  assert.equal(toReadonly('x'), 'x');
  const ro = toReadonly(raw);
  assert.equal(isReadonly(ro), true);
  assert.equal(isReadonly(toReadonly(ro)), true); // already readonly: identity
  const another = toReadonly({ a: 1 });
  assert.equal(isReadonly(another), true);
  another.a = 2; // readonly writes are silently ignored (prod semantics)
  assert.equal(another.a, 1);
});

test('stop(runner) stops an effect runner (Vue 3.6)', () => {
  const count = ref(0);
  let runs = 0;
  const runner = effect(() => { runs++; count.value; });
  count.value = 1;
  assert.equal(runs, 2);
  stop(runner);
  count.value = 2;
  assert.equal(runs, 2); // no more runs after stop
  // stopping twice is a no-op
  stop(runner);
  count.value = 3;
  assert.equal(runs, 2);
});

test('traverse is exported for manual deep dependency collection', () => {
  const state = reactive({ a: { b: 1 }, list: [{ x: 1 }] });
  let reruns = 0;
  const runner = effect(() => { reruns++; traverse(state); });
  assert.equal(reruns, 1);
  state.a.b = 5;
  assert.equal(reruns, 2);
  state.list[0].x = 7;
  assert.equal(reruns, 3);
  stop(runner);
});

test('SchedulerJobFlags QUEUED flag deduplicates concurrent queueJob calls', async () => {
  let runs = 0;
  const job = () => { runs++; };
  queueJob(job);
  queueJob(job);            // second call should be deduped (QUEUED already set)
  queueJob(job);
  await nextTick();
  assert.equal(runs, 1);    // only one flush, one execution
});

test('SchedulerJobFlags DISPOSED skips the job on flush', async () => {
  let runs = 0;
  const job = () => { runs++; };
  job.flags = SchedulerJobFlags.DISPOSED;
  queueJob(job);
  await nextTick();
  assert.equal(runs, 0);    // skipped
});

test('SchedulerJobFlags recursion limit stops infinite self-rescheduling', async () => {
  let count = 0;
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => { errs.push(a.join('')); };
  try {
    const selfJob = () => {
      count++;
      queueJob(selfJob, Infinity, true); // re-queue self (ALLOW_RECURSE)
    };
    queueJob(selfJob, Infinity, true);
    await nextTick();
    // should be limited to ~100-101 runs
    assert.ok(count >= 98 && count <= 102, `count=${count} should be ~100`);
    assert.ok(errs.length > 0, 'should have error about recursion limit');
    assert.ok(errs[0].includes('recursive'), errs[0]);
  } finally {
    console.error = origErr;
  }
});

test('queuePostFlushCb runs after main queue', async () => {
  const order = [];
  const job = () => { order.push('main'); };
  queueJob(job);
  queuePostFlushCb(() => { order.push('post'); });
  await nextTick();
  assert.deepEqual(order, ['main', 'post']);
});

test('flushOnAppMount flushes synchronously without pending microtask', () => {
  let ran = 0;
  const job = () => { ran++; };
  queueJob(job);
  flushOnAppMount(); // synchronously flushes
  assert.equal(ran, 1);
});

test('ref values participate in dependency tracking', () => {
  const count = ref(0);
  let observed = -1;
  effect(() => { observed = count.value; });
  assert.equal(observed, 0);
  count.value = 2;
  assert.equal(observed, 2);
});

test('shallowRef tracks replacement and triggerRef tracks manual deep mutation', () => {
  const state = shallowRef({ count: 0 });
  let observed = '';
  let runs = 0;
  effect(() => { runs++; observed = String(state.value.count); });
  state.value.count = 1;
  assert.equal(runs, 1);
  assert.equal(observed, '0');
  triggerRef(state);
  assert.equal(runs, 2);
  assert.equal(observed, '1');
  state.value = { count: 2 };
  assert.equal(runs, 3);
  assert.equal(observed, '2');
});

test('shallowReactive tracks root properties without proxying nested values', () => {
  const nested = { count: 0 };
  const state = shallowReactive({ enabled: false, nested });
  let runs = 0;
  let observed = false;
  effect(() => { runs++; observed = state.enabled; state.nested.count; });
  assert.equal(isReactive(state), true);
  assert.equal(isReactive(state.nested), false);
  state.nested.count++;
  assert.equal(runs, 1);
  state.enabled = true;
  assert.equal(runs, 2);
  assert.equal(observed, true);
  assert.notEqual(reactive(nested), state.nested);
});

test('isShallow detects shallow proxies and shallow refs only', () => {
  assert.equal(isShallow(shallowReactive({})), true);
  assert.equal(isShallow(shallowReadonly({})), true);
  assert.equal(isShallow(shallowRef(1)), true);
  assert.equal(isShallow(reactive({})), false);
  assert.equal(isShallow(readonly({})), false);
  assert.equal(isShallow(ref(1)), false);
  assert.equal(isShallow({}), false);
});

test('isProxy detects reactive and readonly proxies but not raw objects or refs', () => {
  assert.equal(isProxy(reactive({})), true);
  assert.equal(isProxy(readonly({})), true);
  assert.equal(isProxy(shallowReactive({})), true);
  assert.equal(isProxy({}), false);
  assert.equal(isProxy(ref(1)), false);
  assert.equal(isProxy(shallowRef(1)), false);
  const state = reactive({ inner: { count: 1 } });
  assert.equal(isProxy(state.inner), true);
});

test('toValue unwraps refs and invokes getters', () => {
  const count = ref(2);
  const doubled = () => count.value * 2;
  const state = reactive({ label: 'hello' });
  assert.equal(toValue(5), 5);
  assert.equal(toValue(count), 2);
  assert.equal(toValue(doubled), 4);
  assert.equal(toValue(() => state.label), 'hello');
  let observed = 0;
  effect(() => { observed = toValue(() => state.label.length); });
  assert.equal(observed, 5);
  state.label = 'bye';
  assert.equal(observed, 3);
});

test('customRef controls when effects are tracked and triggered', () => {
  let raw = 0;
  const debounced = customRef((track, trigger) => ({
    get() { track(); return raw; },
    set(value) { raw = value; trigger(); }
  }));
  let observed = -1;
  let runs = 0;
  effect(() => { runs++; observed = debounced.value; });
  assert.equal(observed, 0);
  debounced.value = 5;
  assert.equal(observed, 5);
  assert.equal(runs, 2);
  assert.equal(debounced.value, 5);
});

test('customRef can gate dependency tracking and triggering independently', () => {
  const source = { value: 1 };
  const tracked = customRef((track, trigger) => ({
    get() { track(); return source.value; },
    set(next) { source.value = next; trigger(); }
  }));
  let observed = 0;
  effect(() => { observed = tracked.value; });
  assert.equal(observed, 1);
  tracked.value = 2;
  assert.equal(observed, 2);
});

test('getCurrentScope reflects the running effect scope', () => {
  assert.equal(getCurrentScope(), undefined);
  const scope = effectScope();
  scope.run(() => {
    assert.equal(getCurrentScope(), scope);
  });
  assert.equal(getCurrentScope(), undefined);
  const parent = effectScope();
  parent.run(() => {
    const child = effectScope();
    child.run(() => {
      assert.equal(getCurrentScope(), child);
    });
    assert.equal(getCurrentScope(), parent);
  });
});

test('reactive arrays find raw values through proxy identity methods', () => {
  const raw = { id: 1 };
  const values = reactive([raw]);
  const proxy = reactive(raw);
  assert.equal(values.includes(proxy), true);
  assert.equal(values.indexOf(proxy), 0);
  assert.equal(values.lastIndexOf(proxy), 0);
});

test('markRaw excludes third-party objects from reactive conversion', () => {
  const instance = markRaw({ nested: { value: 1 } });
  assert.equal(reactive(instance), instance);
  assert.equal(shallowReactive(instance), instance);
  assert.equal(isReactive(instance), false);
  instance.nested.value = 2;
  assert.equal(instance.nested.value, 2);
});

test('readonly proxies preserve values while rejecting writes', () => {
  const raw = { count: 1, nested: { value: 2 } };
  const state = readonly(raw);
  const shallow = shallowReadonly(raw);
  state.count = 3;
  state.nested.value = 4;
  assert.equal(state.count, 1);
  assert.equal(state.nested.value, 2);
  assert.equal(isReadonly(state), true);
  assert.equal(isReadonly(state.nested), true);
  assert.equal(isReadonly(shallow), true);
  assert.equal(isReadonly(shallow.nested), false);
  const values = readonly(new Map([['item', { label: 'A' }]]));
  values.set('item', { label: 'B' });
  assert.equal(values.get('item').label, 'A');
  assert.equal(isReadonly(values.get('item')), true);
});

test('readonly Map and Set mutators return Vue-compatible values without mutating', () => {
  const rawMap = new Map([['item', 1]]);
  const rawSet = new Set(['item']);
  const map = readonly(rawMap);
  const set = readonly(rawSet);

  assert.equal(map.set('next', 2), map);
  assert.equal(map.delete('item'), false);
  assert.equal(map.clear(), undefined);
  assert.deepEqual([...rawMap], [['item', 1]]);

  assert.equal(set.add('next'), set);
  assert.equal(set.delete('item'), false);
  assert.equal(set.clear(), undefined);
  assert.deepEqual([...rawSet], ['item']);
});

test('readonly views retain dependency tracking from reactive sources', () => {
  const source = reactive({ count: 0 });
  const view = readonly(source);
  let observed = 0;
  effect(() => { observed = view.count; });
  source.count = 1;
  assert.equal(observed, 1);
  view.count = 2;
  assert.equal(source.count, 1);
});

test('reactive Map and Set track keyed and iteration dependencies', () => {
  const values = reactive(new Map([['a', 1]]));
  const tags = reactive(new Set(['a']));
  let mapped = 0;
  let mapSize = 0;
  let hasTag = false;
  let tagSize = 0;
  effect(() => { mapped = values.get('a'); });
  effect(() => { mapSize = values.size; });
  effect(() => { hasTag = tags.has('a'); });
  effect(() => { tagSize = tags.size; });
  values.set('a', 2);
  values.set('b', 3);
  tags.delete('a');
  tags.add('b');
  assert.equal(mapped, 2);
  assert.equal(mapSize, 2);
  assert.equal(hasTag, false);
  assert.equal(tagSize, 1);
});

test('reactive collection iterators proxy nested values and forEach collections', () => {
  const map = reactive(new Map([['item', { label: 'A' }]]));
  const set = reactive(new Set([{ label: 'B' }]));
  let mapLabel = '';
  let setLabel = '';
  let iteratedMap;
  effect(() => { mapLabel = [...map.values()][0].label; });
  effect(() => { setLabel = [...set][0].label; });
  effect(() => { map.forEach((_value, _key, collection) => { iteratedMap = collection; }); });
  const mapValue = map.get('item');
  const setValue = [...set][0];
  mapValue.label = 'A2';
  setValue.label = 'B2';
  assert.equal(mapLabel, 'A2');
  assert.equal(setLabel, 'B2');
  assert.equal(iteratedMap, map);
  assert.deepEqual([...set.entries()][0], [setValue, setValue]);
});

test('reactive collections normalize raw and proxy object identities', () => {
  const rawKey = { id: 1 };
  const proxyKey = reactive(rawKey);
  const rawMap = new Map([[rawKey, 'value']]);
  const map = reactive(rawMap);
  const set = reactive(new Set([rawKey]));
  assert.equal(map.get(proxyKey), 'value');
  assert.equal(map.has(proxyKey), true);
  assert.equal(set.has(proxyKey), true);
  map.set(proxyKey, 'updated');
  assert.equal(map.size, 1);
  assert.equal(map.get(rawKey), 'updated');
  assert.equal(set.delete(proxyKey), true);
  assert.equal(set.size, 0);
  assert.equal(map.delete(proxyKey), true);
  assert.equal(map.size, 0);
  assert.equal(toRaw(proxyKey), rawKey);
  assert.equal(toRaw(map), rawMap);
});

test('watch tracks getters and reactive objects while running registered cleanup', () => {
  const state = reactive({ count: 0, nested: { enabled: false } });
  const changes = [];
  const stop = watch(() => state.count, (value, previous, onCleanup) => {
    changes.push([value, previous]);
    onCleanup(() => changes.push(['cleanup', value]));
  }, { immediate: true });
  state.count = 1;
  state.count = 2;
  stop();
  assert.deepEqual(changes, [[0, undefined], ['cleanup', 0], [1, 0], ['cleanup', 1], [2, 1], ['cleanup', 2]]);

  let nestedRuns = 0;
  const stopNested = watch(state, () => { nestedRuns++; });
  state.nested.enabled = true;
  assert.equal(nestedRuns, 1);
  stopNested();
});

test('watch observes multiple sources with indexed values and cleanup', async () => {
  const first = ref(0);
  const second = reactive({ value: 'A' });
  const changes = [];
  const stop = watch([first, () => second.value], (value, previous, onCleanup) => {
    changes.push([value, previous]);
    onCleanup(() => changes.push(['cleanup']));
  }, { flush: 'post' });
  first.value = 1;
  second.value = 'B';
  await nextTick();
  assert.deepEqual(changes, [[[1, 'B'], [0, 'A']]]);
  stop();
  first.value = 2;
  await nextTick();
  assert.deepEqual(changes, [[[1, 'B'], [0, 'A']], ['cleanup']]);
});

test('deep watchers traverse Map, Set, and enumerable symbol properties', () => {
  const symbol = Symbol('enabled');
  const map = reactive(new Map([['item', { value: 0 }]]));
  const set = reactive(new Set([{ value: 0 }]));
  const object = reactive({ [symbol]: { value: 0 } });
  let mapRuns = 0;
  let setRuns = 0;
  let symbolRuns = 0;
  watch(map, () => { mapRuns++; }, { deep: true });
  watch(set, () => { setRuns++; }, { deep: true });
  watch(object, () => { symbolRuns++; }, { deep: true });
  map.get('item').value++;
  [...set][0].value++;
  object[symbol].value++;
  assert.equal(mapRuns, 1);
  assert.equal(setRuns, 1);
  assert.equal(symbolRuns, 1);
});

test('post-flush watches batch updates behind nextTick', async () => {
  const state = reactive({ count: 0 });
  const values = [];
  watch(() => state.count, value => values.push(value), { flush: 'post' });
  state.count = 1;
  state.count = 2;
  assert.deepEqual(values, []);
  await nextTick();
  assert.deepEqual(values, [2]);
});

test('once watchers stop after the first change and run cleanup', async () => {
  const state = ref(0);
  const events = [];
  watch(state, value => {
    events.push(`value:${value}`);
    onWatcherCleanup(() => events.push(`cleanup:${value}`));
  }, { once: true, flush: 'post' });
  state.value = 1;
  state.value = 2;
  await nextTick();
  state.value = 3;
  await nextTick();
  assert.deepEqual(events, ['value:2', 'cleanup:2']);

  const immediate = [];
  watch(state, value => immediate.push(value), { immediate: true, once: true });
  state.value = 4;
  assert.deepEqual(immediate, [3]);
});

test('stopped queued watches do not run after their job is invalidated', async () => {
  const state = ref(0);
  let runs = 0;
  const stop = watch(state, () => { runs++; }, { flush: 'post' });
  state.value = 1;
  stop();
  await nextTick();
  assert.equal(runs, 0);
});

test('pre and post watchers observe the correct render boundary', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const events = [];
  const state = reactive({ count: 0 });
  watch(() => state.count, () => events.push(`pre:${root.textContent}`), { flush: 'pre' });
  watch(() => state.count, () => events.push(`post:${root.textContent}`), { flush: 'post' });
  createApp(() => h('span', {}, state.count), state).mount(root);
  state.count = 1;
  state.count = 2;
  assert.deepEqual(events, []);
  await nextTick();
  assert.deepEqual(events, ['pre:0', 'post:2']);
});

test('watch effect flush options observe the render boundary', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const events = [];
  const state = reactive({ count: 0 });
  watchSyncEffect(() => events.push(`sync:${root.textContent}:${state.count}`));
  watchEffect(() => events.push(`pre:${root.textContent}:${state.count}`), { flush: 'pre' });
  watchPostEffect(() => events.push(`post:${root.textContent}:${state.count}`));
  createApp(() => h('span', {}, state.count), state).mount(root);
  events.length = 0;
  state.count = 1;
  assert.deepEqual(events, ['sync:0:1']);
  await nextTick();
  assert.deepEqual(events, ['sync:0:1', 'pre:0:1', 'post:1:1']);
});

test('nextTick accepts a callback after queued jobs flush', async () => {
  const state = reactive({ count: 0 });
  const values = [];
  effect(() => state.count, { scheduler: () => values.push(state.count) });
  state.count = 1;
  const result = await nextTick(() => `${state.count}:done`);
  assert.deepEqual(values, [1]);
  assert.equal(result, '1:done');
});

test('watchEffect cleans up stale work and can be stopped', () => {
  const state = reactive({ count: 0 });
  const events = [];
  const stop = watchEffect(onCleanup => {
    events.push(`run:${state.count}`);
    onCleanup(() => events.push(`cleanup:${state.count}`));
  });
  state.count = 1;
  stop();
  state.count = 2;
  assert.deepEqual(events, ['run:0', 'cleanup:1', 'run:1', 'cleanup:1']);
});

test('onWatcherCleanup registers cleanup for watch and watchEffect callbacks', () => {
  const state = ref(0);
  const events = [];
  const stopWatch = watch(state, value => {
    events.push(`watch:${value}`);
    onWatcherCleanup(() => events.push(`watch-cleanup:${value}`));
  }, { immediate: true });
  state.value = 1;
  stopWatch();

  const stopEffect = watchEffect(() => {
    events.push(`effect:${state.value}`);
    onWatcherCleanup(() => events.push(`effect-cleanup:${state.value}`));
  });
  state.value = 2;
  stopEffect();

  assert.deepEqual(events, [
    'watch:0', 'watch-cleanup:0', 'watch:1', 'watch-cleanup:1',
    'effect:1', 'effect-cleanup:2', 'effect:2', 'effect-cleanup:2'
  ]);
  assert.throws(() => onWatcherCleanup(() => {}), /watch\(\) or watchEffect\(\)/);
});

test('onWatcherCleanup preserves outer scope and runs every registered cleanup', () => {
  const state = ref(0);
  const events = [];
  const scope = effectScope();
  let stop;
  scope.run(() => {
    stop = watch(state, value => {
      onWatcherCleanup(() => events.push(`first:${value}`));
      watchEffect(() => onWatcherCleanup(() => events.push(`nested:${value}`)));
      onWatcherCleanup(() => events.push(`second:${value}`));
    }, { immediate: true });
  });
  state.value = 1;
  assert.deepEqual(events, ['first:0', 'second:0']);
  stop();
  assert.deepEqual(events, ['first:0', 'second:0', 'first:1', 'second:1']);
  scope.stop();
});

test('effectScope.stop runs watcher cleanup and stops watcher effects', () => {
  const state = ref(0);
  const events = [];
  const scope = effectScope();
  scope.run(() => {
    watch(state, value => {
      events.push(`watch:${value}`);
      onWatcherCleanup(() => events.push(`watch-cleanup:${value}`));
    }, { immediate: true });
    watchEffect(() => {
      events.push(`effect:${state.value}`);
      onWatcherCleanup(() => events.push(`effect-cleanup:${state.value}`));
    });
  });
  scope.stop();
  state.value = 1;
  assert.deepEqual(events, ['watch:0', 'effect:0', 'watch-cleanup:0', 'effect-cleanup:0']);
});

test('async components render loading, resolved, and error states', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let resolve;
  const Async = defineAsyncComponent({
    loader: () => new Promise(done => { resolve = done; }),
    loadingComponent: () => h('p', {}, 'Loading'),
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  const app = createApp(() => h('section', {}, [h(Async)]));
  app.mount(root);
  assert.equal(root.textContent, 'Loading');
  resolve(() => h('strong', {}, 'Ready'));
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Ready');
  app.unmount();

  const Failed = defineAsyncComponent({
    loader: () => Promise.reject(new Error('offline')),
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  createApp(() => h(Failed)).mount(root);
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Error:offline');
});

test('async components unwrap default exports from dynamic ES module imports', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Async = defineAsyncComponent(() => Promise.resolve({
    default: () => h('strong', { class: 'panel' }, 'Loaded module')
  }));
  const app = createApp(() => h(Suspense, { fallback: h('p', {}, 'Loading') }, [h(Async)]));
  app.mount(root);
  assert.equal(root.textContent, 'Loading');
  await Promise.resolve();
  await nextTick();
  assert.equal(root.querySelector('strong').className, 'panel');
  assert.equal(root.textContent, 'Loaded module');
  app.unmount();
});

test('async components can retry or fail through the Vue-compatible error hook', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const attempts = [];
  const Retryable = defineAsyncComponent({
    loader: () => {
      const attempt = attempts.length + 1;
      attempts.push(attempt);
      return attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(() => h('strong', {}, 'Recovered'));
    },
    onError(error, retry, fail, attempt) {
      assert.equal(error.message, 'offline');
      assert.equal(attempt, 1);
      retry();
      fail();
    },
    errorComponent: () => h('p', {}, 'Failed')
  });
  const retryApp = createApp(() => h(Suspense, { fallback: h('p', {}, 'Loading') }, [h(Retryable)]));
  retryApp.mount(root);
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(root.textContent, 'Recovered');
  retryApp.unmount();

  const Failed = defineAsyncComponent({
    loader: () => Promise.reject(new Error('forbidden')),
    onError(_error, _retry, fail, attempt) {
      assert.equal(attempt, 1);
      fail();
    },
    errorComponent: props => h('p', {}, `Error:${props.error.message}`)
  });
  createApp(() => h(Failed)).mount(root);
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
  assert.equal(root.textContent, 'Error:forbidden');
});

test('proxyRefs unwraps genuine refs without confusing ordinary value properties', () => {
  const count = ref(1);
  const payload = { value: 'preserve me' };
  const state = proxyRefs({ count, label: 'Before', payload });
  assert.equal(isRef(count), true);
  assert.equal(isRef(payload), false);
  assert.equal(unref(count), 1);
  assert.equal(state.count, 1);
  assert.equal(state.payload, payload);
  state.count = 2;
  state.label = 'After';
  assert.equal(count.value, 2);
  assert.equal(state.label, 'After');
});

test('computed values participate in the ref contract', () => {
  const count = ref(2);
  const doubled = computed(() => count.value * 2);
  assert.equal(isRef(doubled), true);
  assert.equal(unref(doubled), 4);
  assert.equal(proxyRefs({ doubled }).doubled, 4);
  count.value = 3;
  assert.equal(doubled.value, 6);
});

test('toRef and toRefs retain reactive property links', () => {
  const state = reactive({ count: 1, label: 'Before', items: ['a'] });
  const count = toRef(state, 'count');
  const { label, items } = toRefs(state);
  let observed = '';
  effect(() => { observed = `${count.value}:${label.value}:${items.value.length}`; });
  count.value = 2;
  state.label = 'After';
  items.value.push('b');
  assert.equal(state.count, 2);
  assert.equal(label.value, 'After');
  assert.equal(observed, '2:After:2');
});

test('effect scopes stop nested effects and run registered cleanup', () => {
  const state = reactive({ count: 0 });
  const scope = effectScope();
  let runs = 0;
  let disposed = false;
  scope.run(() => {
    effect(() => { runs++; state.count; });
    onScopeDispose(() => { disposed = true; });
  });
  state.count++;
  assert.equal(runs, 2);
  scope.stop();
  state.count++;
  assert.equal(runs, 2);
  assert.equal(disposed, true);
});

test('effect scopes stop owned children while detached scopes survive', () => {
  const state = reactive({ count: 0 });
  const parent = effectScope();
  const child = parent.run(() => effectScope());
  const detached = parent.run(() => effectScope(true));
  let childRuns = 0;
  let detachedRuns = 0;
  child.run(() => effect(() => { childRuns++; state.count; }));
  detached.run(() => effect(() => { detachedRuns++; state.count; }));
  state.count++;
  assert.equal(childRuns, 2);
  assert.equal(detachedRuns, 2);
  parent.stop();
  state.count++;
  assert.equal(childRuns, 2);
  assert.equal(detachedRuns, 3);
  detached.stop();
  state.count++;
  assert.equal(detachedRuns, 3);
});

test('HMR polling replays every missed version in order', async () => {
  installDom();
  globalThis.EventSource = undefined;
  let phase = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => phase === 0
      ? { version: 1, historyComplete: true, changes: [{ path: 'initial.html', kind: 'MODIFY', version: 1 }] }
      : {
          version: 3,
          historyComplete: true,
          changes: [
            { path: 'profile.html', kind: 'MODIFY', version: 2 },
            { path: 'counter.html', kind: 'MODIFY', version: 3 }
          ]
        }
  });
  const versions = [];
  window.addEventListener('thymeleaf-reactive:template-change', event => versions.push(event.detail.version));
  const close = connectComponentHmr('/events', '/status', 5);
  await new Promise(resolve => setTimeout(resolve, 15));
  phase = 1;
  await new Promise(resolve => setTimeout(resolve, 35));
  close();
  assert.deepEqual(versions, [2, 3]);
});

test('closing HMR ignores an in-flight polling response', async () => {
  installDom();
  globalThis.EventSource = undefined;
  let resolveResponse;
  globalThis.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
  const versions = [];
  window.addEventListener('thymeleaf-reactive:template-change', event => versions.push(event.detail.version));
  const close = connectComponentHmr('/events', '/status', 1000);
  close();
  resolveResponse({
    ok: true,
    json: async () => ({
      version: 2,
      historyComplete: true,
      changes: [{ path: 'profile.html', kind: 'MODIFY', version: 2 }]
    })
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(versions, []);
});

test('reactive effects clean stale branches and track array length changes', () => {
  const state = reactive({ enabled: true, first: 'A', second: 'B', items: ['x'] });
  let value = '';
  let runs = 0;
  effect(() => {
    runs++;
    value = state.enabled ? state.first : state.second;
  });
  state.enabled = false;
  assert.equal(value, 'B');
  const branchRuns = runs;
  state.first = 'ignored';
  assert.equal(runs, branchRuns);
  state.second = 'C';
  assert.equal(value, 'C');

  let length = 0;
  effect(() => { length = state.items.length; });
  state.items.push('y');
  assert.equal(length, 2);
  state.items.pop();
  assert.equal(length, 1);
});

test('reactive objects track property existence checks', () => {
  const state = reactive({});
  const values = [];
  effect(() => { values.push('ready' in state); });
  state.ready = true;
  delete state.ready;
  assert.deepEqual(values, [false, true, false]);
});

test('effects can be stopped and apps can be unmounted cleanly', () => {
  const document = installDom();
  const state = reactive({ count: 0 });
  let runs = 0;
  const runner = effect(() => { runs++; state.count; });
  state.count++;
  assert.equal(runs, 2);
  runner.stop();
  state.count++;
  assert.equal(runs, 2);

  const root = document.createElement('main');
  const app = createApp(current => h('span', {}, String(current.count)), state);
  app.mount(root);
  assert.equal(root.textContent, '2');
  app.unmount();
  assert.equal(root.textContent, '');
  state.count++;
  assert.equal(root.textContent, '');
});

test('component HMR patches only mounted named component instances and cleans up on unmount', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Badge = defineComponent('badge-hmr-test', () => h('strong', { class: 'badge' }, 'Before'));
  const app = createApp(() => h('section', {}, [h('p', {}, 'Outside'), h(Badge)]));
  app.mount(root);
  const outside = root.querySelector('p');
  const badge = root.querySelector('strong');
  assert.equal(hotUpdate('badge-hmr-test', () => h('strong', { class: 'badge updated' }, 'After')), true);
  assert.equal(root.querySelector('p'), outside);
  assert.equal(root.querySelector('strong'), badge);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('strong').className, 'badge updated');
  app.unmount();
  hotUpdate('badge-hmr-test', () => h('strong', {}, 'Ignored'));
  assert.equal(root.textContent, '');
});

test('component HMR accepts object component replacements without refreshing the host tree', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = defineComponent('object-hmr-test', { render: () => h('strong', { class: 'before' }, 'Before') });
  const app = createApp(() => h('section', {}, [h('p', {}, 'Host'), h(Panel)]));
  app.mount(root);
  const host = root.querySelector('p');
  assert.equal(hotUpdate('object-hmr-test', { render: () => h('strong', { class: 'after' }, 'After') }), true);
  assert.equal(root.querySelector('p'), host);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('strong').className, 'after');
  app.unmount();
});

test('component HMR preserves script setup local refs while replacing its template', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const initial = compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `);
  const Counter = defineComponent('script-setup-hmr-state-test', initial);
  const app = createApp(() => h('section', {}, [h(Counter)]));
  app.mount(root);
  const button = root.querySelector('button');
  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');

  const replacement = compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `);
  assert.equal(hotUpdate('script-setup-hmr-state-test', replacement), true);
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
  app.unmount();
});

test('component HMR recreates script setup state when its script changes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('script-setup-hmr-script-change-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.textContent, 'Count: 2');

  assert.equal(hotUpdate('script-setup-hmr-script-change-test', compileSfcComponent(`
    <template><button @click="increment">Changed count: {{ count }}</button></template>
    <script setup>
      const count = ref(10);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(root.textContent, 'Changed count: 10');
  app.unmount();
});

test('adopted script setup components preserve local refs across HMR', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><button>Server</button></section>';
  const root = document.querySelector('section');
  const Counter = defineComponent('adopted-script-setup-hmr-state-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  adoptComponentRoot(root, Counter);
  const button = document.querySelector('button');
  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');

  assert.equal(hotUpdate('adopted-script-setup-hmr-state-test', compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(document.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
});

test('fragment components patch and hot-update multiple root nodes as one range', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Pair = defineComponent('fragment-hmr-test', () => h(Fragment, {}, [
    h('strong', { key: 'title' }, 'Before'),
    h('em', { key: 'detail' }, 'Detail')
  ]));
  const app = createApp(() => h('section', {}, [h(Pair), h('p', { key: 'outside' }, 'Outside')]));
  app.mount(root);
  const outside = root.querySelector('p');
  const title = root.querySelector('strong');
  assert.equal(hotUpdate('fragment-hmr-test', () => h(Fragment, {}, [
    h('strong', { key: 'title' }, 'After'),
    h('code', { key: 'detail' }, 'Replacement detail')
  ])), true);
  assert.equal(root.querySelector('strong'), title);
  assert.equal(root.querySelector('strong').textContent, 'After');
  assert.equal(root.querySelector('code').textContent, 'Replacement detail');
  assert.equal(root.querySelector('p'), outside);
  app.unmount();
  assert.equal(root.textContent, '');
});

test('keyed fragment children move their full DOM ranges together', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(state => h('ul', {}, state.items.map(item => h(Fragment, { key: item.id }, [
    h('li', { key: 'label' }, item.label),
    h('li', { key: 'meta' }, item.meta)
  ]))), { items: [{ id: 'a', label: 'A', meta: 'A*' }, { id: 'b', label: 'B', meta: 'B*' }] });
  const state = app.mount(root);
  const initial = root.querySelectorAll('li');
  const firstB = initial[2];
  const secondB = initial[3];
  state.items = [{ id: 'b', label: 'B2', meta: 'B2*' }, { id: 'a', label: 'A', meta: 'A*' }];
  await nextTick();
  const rows = root.querySelectorAll('li');
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], secondB);
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'B2*', 'A', 'A*']);
});

test('component HMR patches server output while preserving field state', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><input data-tr-key="draft" value="server"><strong data-tr-key="label">Before</strong></section>';
  const input = document.querySelector('input');
  input.value = 'typing';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="counter"><input data-tr-key="draft" value="new-server"><strong data-tr-key="label">After</strong></section></body></html>'
  });
  await refreshComponentsFromPage('counter');
  assert.equal(document.querySelector('strong').textContent, 'After');
  assert.equal(document.querySelector('input'), input);
  assert.equal(document.querySelector('input').value, 'typing');
});

test('component HMR reconciles keyed component instances across reorders, additions, and removals', async () => {
  const document = installDom();
  document.body.innerHTML = [
    '<div id="components">',
    '<section data-tr-component="row" data-tr-key="a" data-tr-state="{&quot;label&quot;:&quot;A&quot;}"><input data-tr-model="label"><strong data-tr-text="label"></strong></section>',
    '<section data-tr-component="row" data-tr-key="b" data-tr-state="{&quot;label&quot;:&quot;B&quot;}"><input data-tr-model="label"><strong data-tr-text="label"></strong></section>',
    '</div>'
  ].join('');
  const oldA = document.querySelector('[data-tr-key="a"]');
  const oldB = document.querySelector('[data-tr-key="b"]');
  hydrate(oldA, { label: 'A' });
  hydrate(oldB, { label: 'B' });
  oldB.querySelector('input').value = 'Typing B';
  oldB.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => [
      '<html><body><div id="components">',
      '<section data-tr-component="row" data-tr-key="b" data-tr-state="{&quot;label&quot;:&quot;B server&quot;}"><input data-tr-model="label"><strong data-tr-text="label">stale</strong></section>',
      '<section data-tr-component="row" data-tr-key="c" data-tr-state="{&quot;label&quot;:&quot;C&quot;}"><input data-tr-model="label"><strong data-tr-text="label">stale</strong></section>',
      '</div></body></html>'
    ].join('')
  });
  await refreshComponentsFromPage('row');
  const rows = document.querySelectorAll('[data-tr-component="row"]');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], oldB);
  assert.equal(document.querySelector('[data-tr-key="a"]'), null);
  assert.equal(rows[0].querySelector('input').value, 'Typing B');
  assert.equal(rows[0].querySelector('strong').textContent, 'Typing B');
  assert.equal(rows[1].dataset.trKey, 'c');
  assert.equal(rows[1].querySelector('strong').textContent, 'C');
  rows[1].querySelector('input').value = 'C updated';
  rows[1].querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(rows[1].querySelector('strong').textContent, 'C updated');
});

test('component HMR inserts a first component instance into a structural parent match', async () => {
  const document = installDom();
  document.body.innerHTML = '<main><section class="slot"></section></main>';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><main><section class="slot"><article data-tr-component="alert" data-tr-state="{&quot;message&quot;:&quot;Ready&quot;}"><strong data-tr-text="message">stale</strong></article></section></main></body></html>'
  });
  await refreshComponentsFromPage('alert');
  assert.equal(document.querySelector('[data-tr-component="alert"] strong').textContent, 'Ready');
});

test('component HMR hydrates reactive bindings introduced by a changed template', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="profile" data-tr-state="{&quot;name&quot;:&quot;Ada&quot;}"><strong>Before</strong></section>';
  const state = hydrate(document.querySelector('section'), { name: 'Ada' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="profile"><strong data-tr-text="name">stale</strong></section></body></html>'
  });
  await refreshComponentsFromPage('profile');
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.name = 'Grace';
  await nextTick();
  assert.equal(document.querySelector('strong').textContent, 'Grace');
});

test('component HMR disposes bindings replaced by a template change', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="profile"><strong data-tr-text="count">1</strong></section>';
  const state = hydrate(document.querySelector('section'), { count: 1, message: 'Ada' });
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="profile"><strong data-tr-text="message">stale</strong></section></body></html>'
  });
  await refreshComponentsFromPage('profile');
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.count = 2;
  assert.equal(document.querySelector('strong').textContent, 'Ada');
  state.message = 'Grace';
  await nextTick();
  assert.equal(document.querySelector('strong').textContent, 'Grace');
});

test('component hydration does not bind descendants owned by nested components', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="outer"><p data-tr-text="label"></p><section data-tr-component="inner"><p data-tr-text="label"></p></section></section>';
  const outerRoot = document.querySelector('[data-tr-component="outer"]');
  const innerRoot = document.querySelector('[data-tr-component="inner"]');
  const outer = hydrate(outerRoot, { label: 'Outer' });
  const inner = hydrate(innerRoot, { label: 'Inner' });
  const labels = document.querySelectorAll('p');
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer', 'Inner']);
  outer.label = 'Outer updated';
  await nextTick();
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer updated', 'Inner']);
  inner.label = 'Inner updated';
  await nextTick();
  assert.deepEqual([...labels].map(label => label.textContent), ['Outer updated', 'Inner updated']);
});

test('component HMR patches server conditional comment anchors', async () => {
  const document = installDom();
  document.body.innerHTML = '<section data-tr-component="counter"><!--tr-if--><p data-tr-if="visible">Before</p></section>';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => '<html><body><section data-tr-component="counter"><!--tr-if--><p data-tr-if="visible">After</p></section></body></html>'
  });
  await refreshComponentsFromPage('counter');
  assert.equal(document.querySelector('p').textContent, 'After');
  assert.equal(document.querySelector('section').firstChild.nodeType, Node.COMMENT_NODE);
});

test('virtual DOM patches changed content without replacing keyed input nodes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(state => h('section', {}, [
    h('input', { key: 'draft', value: state.draft }),
    h('strong', { key: 'count' }, String(state.count))
  ]), { draft: 'kept', count: 0 });
  const state = app.mount(root);
  const input = root.querySelector('input');
  state.count = 1;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '1');
  assert.equal(root.querySelector('input'), input);
  assert.equal(root.querySelector('input').value, 'kept');
});

test('VNode refs follow native and component mount, patch, and unmount lifecycles', () => {
  const document = installDom();
  const root = document.createElement('main');
  const elementRef = ref(null);
  const componentRef = ref(null);
  const Child = { setup: () => () => h('span', {}, 'child') };
  const app = createApp(() => h('section', {}, [
    h('input', { ref: elementRef }),
    h(Child, { ref: componentRef })
  ]));
  app.mount(root);
  assert.equal(elementRef.value, root.querySelector('input'));
  assert.ok(componentRef.value);
  assert.equal(root.querySelector('input').hasAttribute('ref'), false);
  const previousElement = elementRef.value;
  app.replaceRender(() => h('section', {}, [h('textarea', { ref: elementRef })]));
  assert.equal(elementRef.value, root.querySelector('textarea'));
  assert.notEqual(elementRef.value, previousElement);
  assert.equal(componentRef.value, null);
  app.unmount();
  assert.equal(elementRef.value, null);
});

test('withDirectives runs native VNode directive hooks through patch and unmount', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = reactive({ count: 0 });
  const events = [];
  const directive = {
    created(_el, binding) { events.push(`created:${binding.value}:${binding.arg}:${binding.modifiers.trim}`); },
    beforeMount(_el, binding) { events.push(`before-mount:${binding.value}`); },
    mounted(_el, binding) { events.push(`mounted:${binding.value}`); },
    beforeUpdate(_el, binding) { events.push(`before-update:${binding.oldValue}->${binding.value}`); },
    updated(_el, binding) { events.push(`updated:${binding.oldValue}->${binding.value}`); },
    beforeUnmount(_el, binding) { events.push(`before-unmount:${binding.value}`); },
    unmounted(_el, binding) { events.push(`unmounted:${binding.value}`); }
  };
  const app = createApp(() => h('section', {}, [
    withDirectives(h('input', { value: state.count }), [[directive, state.count, 'field', { trim: true }]])
  ]));
  app.mount(root);
  assert.deepEqual(events, ['created:0:field:true', 'before-mount:0', 'mounted:0']);
  state.count = 1;
  await nextTick();
  assert.deepEqual(events.slice(3), ['before-update:0->1', 'updated:0->1']);
  app.unmount();
  assert.deepEqual(events.slice(5), ['before-unmount:1', 'unmounted:1']);
});

test('render retains the previous tree and supports explicit unmounting', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('section', {}, [h('input', { key: 'draft', value: 'kept' }), h('strong', {}, 'Before')]), root);
  const input = root.querySelector('input');
  render(h('section', {}, [h('input', { key: 'draft', value: 'kept' }), h('strong', {}, 'After')]), root);
  assert.equal(root.querySelector('input'), input);
  assert.equal(root.textContent, 'After');
  render(null, root);
  assert.equal(root.childNodes.length, 0);
});

test('hydrateRender adopts compatible SSR nodes and recovers structural mismatches', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<section class="server"><span>stale</span><i>remove me</i></section>';
  const section = root.firstElementChild;
  const span = section.firstElementChild;
  const tree = hydrateRender(h('section', { class: 'client' }, [h('span', {}, 'ready'), h('strong', {}, 'added')]), root);
  assert.equal(tree.el, section);
  assert.equal(section.className, 'client');
  assert.equal(section.firstElementChild, span);
  assert.equal(section.textContent, 'readyadded');
  assert.equal(section.querySelector('i'), null);
  const next = render(h('section', { class: 'updated' }, [h('span', {}, 'done')]), root);
  assert.equal(next.el, section);
  assert.equal(section.className, 'updated');
  assert.equal(section.textContent, 'done');
});

test('hydrateRender adopts a Suspense fallback before resolving async content', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<p class="server">Loading</p>';
  const fallback = root.firstElementChild;
  let resolve;
  const Async = defineAsyncComponent(() => new Promise(done => { resolve = done; }));
  const pending = () => h(Suspense, { fallback: h('p', { class: 'client' }, 'Loading') }, [h(Async)]);

  const tree = hydrateRender(pending(), root);
  assert.equal(tree.component.el, fallback);
  assert.equal(root.firstElementChild, fallback);
  assert.equal(fallback.className, 'client');

  resolve(() => h('strong', {}, 'Ready'));
  await Promise.resolve();
  await nextTick();
  render(pending(), root);
  assert.equal(root.textContent, 'Ready');
  assert.equal(root.querySelector('strong').textContent, 'Ready');
});

test('hydrateRender adopts multi-root SSR fragments as one patchable range', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<span>one</span><p>stale</p><i>remove me</i>';
  const first = root.firstElementChild;
  const tree = hydrateRender(h(Fragment, {}, [
    h('span', { key: 'one' }, 'updated'),
    h('strong', { key: 'two' }, 'two')
  ]), root);
  assert.equal(tree.el.nodeType, Node.COMMENT_NODE);
  assert.equal(tree.anchor.nodeType, Node.COMMENT_NODE);
  assert.equal(root.firstElementChild, first);
  assert.deepEqual([...root.children].map(element => element.textContent), ['updated', 'two']);
  const next = render(h(Fragment, {}, [
    h('strong', { key: 'two' }, 'changed'),
    h('span', { key: 'one' }, 'moved')
  ]), root);
  assert.equal(next.el, tree.el);
  assert.deepEqual([...root.children].map(element => element.textContent), ['changed', 'moved']);
});

test('hydrateRender creates component instances on top of SSR roots', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button class="server">stale</button>';
  const button = root.firstElementChild;
  const hooks = [];
  const Counter = {
    props: ['label'],
    setup(props) {
      const count = ref(0);
      onMounted(() => hooks.push('mounted'));
      return () => h('button', {
        class: 'client',
        onClick: () => count.value++
      }, `${props.label}:${count.value}`);
    }
  };
  const tree = hydrateRender(h(Counter, { label: 'Count' }), root);
  assert.equal(tree.instance !== undefined, true);
  assert.equal(root.firstElementChild, button);
  assert.equal(button.className, 'client');
  assert.equal(button.textContent, 'Count:0');
  assert.deepEqual(hooks, ['mounted']);
  button.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.firstElementChild, button);
  assert.equal(button.textContent, 'Count:1');
});

test('hydrateRender binds VNode refs and clears them on unmount', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<section><span>child</span></section>';
  const elementRef = ref(null);
  const componentRef = ref(null);
  const Child = { setup: () => () => h('span', {}, 'child') };
  hydrateRender(h('section', { ref: elementRef }, [h(Child, { ref: componentRef })]), root);
  assert.equal(elementRef.value, root.querySelector('section'));
  assert.ok(componentRef.value);
  render(null, root);
  assert.equal(elementRef.value, null);
  assert.equal(componentRef.value, null);
});

test('hydrateRender registers named component instances for state-preserving HMR', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button>Server</button>';
  const Counter = defineComponent('hydrated-component-hmr-test', compileSfcComponent(`
    <template><button @click="increment">Count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `));
  hydrateRender(h(Counter), root);
  const button = root.querySelector('button');
  button.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(button.textContent, 'Count: 2');
  assert.equal(hotUpdate('hydrated-component-hmr-test', compileSfcComponent(`
    <template><button @click="increment">Updated count: {{ count }}</button></template>
    <script setup>
      const count = ref(1);
      function increment() { count.value++; }
    </script>
  `)), true);
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'Updated count: 2');
});

test('VNode children normalize nested arrays as Fragment ranges', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('div', {}, [
    h('span', {}, 'one'),
    [h('strong', {}, 'two'), h('em', {}, 'three')]
  ]), root);
  assert.equal(root.textContent, 'onetwothree');
  assert.equal(root.querySelectorAll('div > span').length, 1);
  assert.equal(root.querySelectorAll('div > strong').length, 1);
  assert.equal(root.querySelectorAll('div > em').length, 1);
});

test('VNode children preserve empty boolean and null positions as comments', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const app = createApp(current => h('div', {}, [current.visible && h('strong', {}, 'Shown'), true, null, 'Stable']), { visible: false });
  const state = app.mount(root);
  assert.equal(root.textContent, 'Stable');
  assert.equal(root.querySelector('div').childNodes.length, 4);
  state.visible = true;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Shown');
  assert.equal(root.querySelector('div').childNodes.length, 4);
  app.unmount();
});

test('h supports Vue-style children shorthand and null props', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('section', [h('strong', 'shorthand'), h('em', null, 'explicit')]), root);
  assert.equal(root.textContent, 'shorthandexplicit');
  assert.equal(root.querySelector('strong').getAttribute('shorthand'), null);
  assert.equal(root.querySelector('em').textContent, 'explicit');
});

test('h accepts multiple children arguments without confusing props', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('section', null, h('strong', {}, 'one'), h('em', {}, 'two'), 'three'), root);
  const section = root.querySelector('section');
  assert.equal(section.textContent, 'onetwothree');
  assert.equal(section.childNodes.length, 3);
});

test('Teleport patches and moves its child range without recreating keyed fields', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const firstTarget = document.createElement('aside');
  const secondTarget = document.createElement('aside');
  firstTarget.id = 'first-target';
  secondTarget.id = 'second-target';
  document.body.append(firstTarget, secondTarget);
  const app = createApp(state => h('section', {}, [
    h('p', {}, 'Host'),
    state.visible && h(Teleport, { to: state.target }, [
      h('input', { key: 'draft', value: state.draft }),
      h('strong', { key: 'label' }, state.label)
    ])
  ]), { visible: true, target: '#first-target', draft: 'Initial', label: 'Before' });
  const state = app.mount(root);
  const input = firstTarget.querySelector('input');
  assert.equal(root.textContent, 'Host');
  assert.equal(firstTarget.querySelector('strong').textContent, 'Before');

  state.label = 'After';
  await nextTick();
  assert.equal(firstTarget.querySelector('input'), input);
  assert.equal(firstTarget.querySelector('strong').textContent, 'After');

  state.target = '#second-target';
  await nextTick();
  assert.equal(firstTarget.querySelector('input'), null);
  assert.equal(secondTarget.querySelector('input'), input);
  assert.equal(secondTarget.querySelector('strong').textContent, 'After');

  state.visible = false;
  await nextTick();
  assert.equal(secondTarget.childNodes.length, 0);
  app.unmount();
});

test('hydrateRender adopts Teleport placeholders and target content', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const target = document.createElement('aside');
  target.id = 'hydrate-target';
  root.innerHTML = '<!--teleport-->';
  target.innerHTML = '<input value="server"><strong>Server</strong><!--/teleport-->';
  document.body.append(root, target);
  const serverInput = target.querySelector('input');
  const tree = hydrateRender(h(Teleport, { to: '#hydrate-target' }, [
    h('input', { key: 'draft', value: 'client' }),
    h('strong', { key: 'label' }, 'Client')
  ]), root);
  assert.equal(tree.el, root.firstChild);
  assert.equal(target.querySelector('input'), serverInput);
  assert.equal(serverInput.value, 'client');
  assert.equal(target.querySelector('strong').textContent, 'Client');

  render(h(Teleport, { to: '#hydrate-target' }, [
    h('input', { key: 'draft', value: 'updated' }),
    h('strong', { key: 'label' }, 'Updated'),
    h('em', { key: 'extra' }, 'Extra')
  ]), root);
  await nextTick();
  assert.equal(target.querySelector('input'), serverInput);
  assert.equal(serverInput.value, 'updated');
  assert.equal(target.querySelector('em').textContent, 'Extra');
  render(null, root);
  assert.equal(root.childNodes.length, 0);
  assert.equal(target.childNodes.length, 0);
});

test('KeepAlive caches keyed component instances across switches', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const hooks = [];
  const Counter = {
    setup(props) {
      const count = ref(0);
      onMounted(() => hooks.push(`mounted:${props.name}`));
      onActivated(() => hooks.push(`activated:${props.name}`));
      onDeactivated(() => hooks.push(`deactivated:${props.name}`));
      onUnmounted(() => hooks.push(`unmounted:${props.name}`));
      return () => h('button', { onClick: () => count.value++ }, `${props.name}:${count.value}`);
    }
  };
  const app = createApp(state => h(KeepAlive, {}, [
    h(Counter, { key: state.name, name: state.name })
  ]), { name: 'A' });
  const state = app.mount(root);
  const firstA = root.querySelector('button');
  firstA.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(firstA.textContent, 'A:1');
  state.name = 'B';
  await nextTick();
  const buttonB = root.querySelector('button');
  assert.equal(buttonB.textContent, 'B:0');
  state.name = 'A';
  await nextTick();
  assert.equal(root.querySelector('button'), firstA);
  assert.equal(firstA.textContent, 'A:1');
  assert.deepEqual(hooks, ['mounted:A', 'activated:A', 'deactivated:A', 'mounted:B', 'activated:B', 'deactivated:B', 'activated:A']);
  state.name = 'B';
  await nextTick();
  assert.equal(root.querySelector('button'), buttonB);
  app.unmount();
  assert.equal(hooks.includes('unmounted:A'), true);
  assert.equal(hooks.includes('unmounted:B'), true);
});

test('KeepAlive max evicts the least recently activated instance', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = {
    setup(props) {
      const count = ref(0);
      return () => h('button', { onClick: () => count.value++ }, `${props.name}:${count.value}`);
    }
  };
  const app = createApp(state => h(KeepAlive, { max: 1 }, [
    h(Counter, { key: state.view, name: state.view })
  ]), { view: 'A' });
  const state = app.mount(root);
  const firstA = root.querySelector('button');
  firstA.dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(firstA.textContent, 'A:1');
  state.view = 'B';
  await nextTick();
  state.view = 'A';
  await nextTick();
  const secondA = root.querySelector('button');
  assert.notEqual(secondA, firstA);
  assert.equal(secondA.textContent, 'A:0');
  app.unmount();
});

test('component updates are deduplicated and committed on nextTick', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let renders = 0;
  const Counter = {
    setup(props) {
      return () => {
        renders++;
        return h('strong', {}, String(props.count));
      };
    }
  };
  const app = createApp(state => h(Counter, { count: state.count }), { count: 0 });
  const state = app.mount(root);
  assert.equal(root.textContent, '0');
  assert.equal(renders, 1);
  state.count = 1;
  state.count = 2;
  assert.equal(root.textContent, '0');
  await nextTick();
  assert.equal(root.textContent, '2');
  assert.equal(renders, 2);
  app.unmount();
});

test('component scheduler updates parents before children', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const updates = [];
  const Child = {
    setup(props) {
      onBeforeUpdate(() => updates.push('child'));
      return () => h('span', {}, String(props.value));
    }
  };
  const Parent = {
    setup(props) {
      onBeforeUpdate(() => updates.push('parent'));
      return () => h('div', {}, [h(Child, { value: props.child })]);
    }
  };
  const app = createApp(state => h(Parent, { parent: state.parent, child: state.child }), { parent: 0, child: 0 });
  const state = app.mount(root);
  state.parent = 1;
  state.child = 1;
  await nextTick();
  assert.deepEqual(updates, ['parent', 'child']);
  assert.equal(root.textContent, '1');
  app.unmount();
});

test('scheduler isolates a failed component job and continues flushing', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let childUpdates = 0;
  const Child = {
    setup(props) {
      onUpdated(() => childUpdates++);
      return () => h('span', {}, String(props.value));
    }
  };
  const Parent = {
    setup(props) {
      onUpdated(() => { throw new Error('parent update failed'); });
      return () => h('div', {}, [h(Child, { value: props.value })]);
    }
  };
  const app = createApp(state => h(Parent, { value: state.value }), { value: 0 });
  const state = app.mount(root);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args);
  try {
    state.value = 1;
    await nextTick();
  } finally {
    console.error = originalError;
  }
  assert.equal(root.textContent, '1');
  assert.equal(childUpdates, 1);
  assert.equal(errors.length, 1);
  app.unmount();
});

test('onErrorCaptured catches child render errors and preserves the last tree', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const captured = [];
  const Child = {
    props: ['broken'],
    setup(props) {
      return () => {
        if (props.broken) throw new Error('child render failed');
        return h('span', {}, 'stable');
      };
    }
  };
  const Parent = {
    props: ['broken'],
    setup(props) {
      onErrorCaptured((error, info) => {
        captured.push([error.message, info]);
        return true;
      });
      return () => h('div', {}, [h(Child, { broken: props.broken })]);
    }
  };
  const app = createApp(state => h(Parent, { broken: state.broken }), { broken: false });
  const state = app.mount(root);
  state.broken = true;
  await nextTick();
  assert.equal(root.textContent, 'stable');
  assert.deepEqual(captured, [['child render failed', 'render']]);
  app.unmount();
});

test('onErrorCaptured handles lifecycle errors without aborting sibling updates', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const captured = [];
  const Failing = {
    props: ['value'],
    setup(props) {
      onUpdated(() => { if (props.value === 1) throw new Error('lifecycle failed'); });
      return () => h('span', {}, `failing:${props.value}`);
    }
  };
  const Stable = {
    props: ['value'],
    setup: props => () => h('strong', {}, `stable:${props.value}`)
  };
  const Boundary = {
    props: ['value'],
    setup(props) {
      onErrorCaptured((error, info) => { captured.push([error.message, info]); return true; });
      return () => h('div', {}, [h(Failing, { value: props.value }), h(Stable, { value: props.value })]);
    }
  };
  const app = createApp(state => h(Boundary, { value: state.value }), { value: 0 });
  const state = app.mount(root);
  state.value = 1;
  await nextTick();
  assert.equal(root.textContent, 'failing:1stable:1');
  assert.deepEqual(captured, [['lifecycle failed', 'updated']]);
  app.unmount();
});

test('onErrorCaptured catches function component render errors and preserves its tree', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const captured = [];
  const Child = props => {
    if (props.failed) throw new Error('function render failed');
    return h('span', {}, `stable:${props.value}`);
  };
  const Parent = {
    setup(props) {
      onErrorCaptured((error, info) => { captured.push([error.message, info]); return true; });
      return () => h('section', {}, [h(Child, { failed: props.failed, value: props.value }), h('i', {}, 'sibling')]);
    }
  };
  const app = createApp(state => h(Parent, { failed: state.failed, value: state.value }), { failed: false, value: 0 });
  const state = app.mount(root);
  const child = root.querySelector('span');
  state.failed = true;
  state.value = 1;
  await nextTick();
  assert.equal(root.querySelector('span'), child);
  assert.equal(child.textContent, 'stable:0');
  assert.equal(root.querySelector('i').textContent, 'sibling');
  assert.deepEqual(captured, [['function render failed', 'render']]);
  app.unmount();
});

test('object components retain setup state and support lifecycle, emits, and injection', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const hooks = [];
  const emitted = [];
  const Child = {
    setup(props, { emit }) {
      const prefix = inject('prefix');
      const clicks = ref(0);
      onBeforeMount(() => hooks.push('child-before-mount'));
      onMounted(() => hooks.push('child-mounted'));
      onBeforeUpdate(() => hooks.push('child-before-update'));
      onUpdated(() => hooks.push('child-updated'));
      onBeforeUnmount(() => hooks.push('child-before-unmount'));
      onUnmounted(() => hooks.push('child-unmounted'));
      return () => h('button', {
        onClick: () => {
          clicks.value++;
          emit('save', clicks.value);
        }
      }, `${prefix}:${props.label}:${clicks.value}`);
    }
  };
  const Parent = {
    setup(props) {
      provide('prefix', 'injected');
      onMounted(() => hooks.push('parent-mounted'));
      onUpdated(() => hooks.push('parent-updated'));
      onUnmounted(() => hooks.push('parent-unmounted'));
      return () => h('section', {}, [h(Child, { label: props.label, onSave: value => emitted.push(value) })]);
    }
  };
  const app = createApp(state => h(Parent, { label: state.label }), { label: 'Before' });
  const state = app.mount(root);
  const button = root.querySelector('button');
  assert.equal(button.textContent, 'injected:Before:0');
  assert.deepEqual(hooks, ['child-before-mount', 'child-mounted', 'parent-mounted']);

  button.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(button.textContent, 'injected:Before:1');
  assert.deepEqual(emitted, [1]);
  assert.equal(hooks.includes('child-before-update'), true);
  assert.equal(hooks.includes('child-updated'), true);

  state.label = 'After';
  await nextTick();
  assert.equal(root.querySelector('button'), button);
  assert.equal(button.textContent, 'injected:After:1');
  assert.equal(hooks.includes('parent-updated'), true);

  app.unmount();
  assert.equal(root.childNodes.length, 0);
  assert.ok(hooks.indexOf('child-before-unmount') < hooks.indexOf('child-unmounted'));
  assert.equal(hooks.includes('child-unmounted'), true);
  assert.equal(hooks.includes('parent-unmounted'), true);
});

test('object components update when an unused prop changes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let updates = 0;
  const Child = {
    props: ['signal'],
    setup(_props) {
      onUpdated(() => { updates++; });
      return () => h('span', {}, 'stable');
    }
  };
  const app = createApp(state => h('section', {}, [h(Child, { signal: state.signal })]), { signal: 0 });
  const state = app.mount(root);
  state.signal = 1;
  await nextTick();
  assert.equal(root.textContent, 'stable');
  assert.equal(updates, 1);
  app.unmount();
});

test('object component props and attrs are readonly but remain reactive', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = {
    props: ['label'],
    setup(props, { attrs }) {
      props.label = 'blocked';
      attrs.title = 'blocked';
      return () => h('span', { title: String(attrs.title) }, String(props.label));
    }
  };
  const app = createApp(state => h(Child, { label: state.label, title: state.title }), { label: 'A', title: 'one' });
  const state = app.mount(root);
  state.label = 'B';
  state.title = 'two';
  await nextTick();
  const child = root.querySelector('span');
  assert.equal(child.textContent, 'B');
  assert.equal(child.title, 'two');
  child.textContent = 'mutated-dom';
  app.unmount();
});

test('object components normalize Vue-style prop options and preserve attrs boundaries', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = {
    props: {
      label: { type: String, required: true },
      enabled: Boolean,
      count: { type: Number, default: 3 },
      meta: { type: Object, default: () => ({ source: 'default' }) }
    },
    setup(props, { attrs }) {
      return () => h('output', { title: attrs.title }, `${props.label}:${props.enabled}:${props.count}:${props.meta.source}`);
    }
  };
  const app = createApp(() => h(Child, { label: 'Ready', enabled: '', title: 'fallthrough' }), {});
  app.mount(root);

  const output = root.querySelector('output');
  assert.equal(output.textContent, 'Ready:true:3:default');
  assert.equal(output.title, 'fallthrough');
  assert.equal(output.getAttribute('enabled'), null);
  assert.equal(output.getAttribute('count'), null);

  app.replaceRender(() => h(Child, { label: 'Updated', enabled: false, count: 7, meta: { source: 'passed' }, title: 'next' }));
  await nextTick();
  assert.equal(output.textContent, 'Updated:false:7:passed');
  assert.equal(output.title, 'next');
  app.replaceRender(() => h(Child, { label: 'Default again', title: 'final' }));
  await nextTick();
  assert.equal(output.textContent, 'Default again:false:3:default');
  assert.equal(output.title, 'final');
  app.unmount();
});

test('object component default prop factories run once per instance', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let factoryRuns = 0;
  let renders = 0;
  const Child = {
    props: { options: { type: Object, default: () => { factoryRuns++; return { ready: true }; } } },
    setup(props) {
      return () => {
        renders++;
        return h('span', {}, `${props.options.ready}:${renders}`);
      };
    }
  };
  const state = reactive({ tick: 0 });
  const app = createApp(() => h('section', {}, [h(Child, state.tick === 1 ? { options: { ready: false } } : {}), h('i', {}, String(state.tick))]));
  app.mount(root);
  assert.equal(factoryRuns, 1);
  state.tick++;
  await nextTick();
  assert.equal(factoryRuns, 1);
  assert.equal(root.querySelector('span').textContent, 'false:2');
  state.tick++;
  await nextTick();
  assert.equal(factoryRuns, 1);
  assert.equal(root.querySelector('span').textContent, 'true:3');
  app.unmount();
});

test('object components skip redundant child renders when parent state is unrelated', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let childRenders = 0;
  const Child = {
    props: ['label'],
    setup(props) {
      return () => {
        childRenders++;
        return h('span', {}, props.label);
      };
    }
  };
  const state = reactive({ parentTick: 0 });
  const app = createApp(() => h('section', {}, [h(Child, { label: 'stable' }), h('i', {}, String(state.parentTick))]));
  app.mount(root);
  assert.equal(childRenders, 1);
  state.parentTick++;
  await nextTick();
  assert.equal(childRenders, 1);
  assert.equal(root.querySelector('span').textContent, 'stable');
  app.unmount();
});

test('object components separate declared props, attrs, and emits', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const emitted = [];
  const Child = {
    props: ['label'],
    emits: ['save'],
    setup(props, { attrs, emit }) {
      return () => h('button', {
        ...attrs,
        onClick: () => emit('save', props.label)
      }, props.label);
    }
  };
  const app = createApp(() => h(Child, {
    label: 'Ready',
    id: 'child',
    title: 'Child',
    onSave: value => emitted.push(value)
  }));
  app.mount(root);
  const button = root.querySelector('button');
  assert.equal(button.textContent, 'Ready');
  assert.equal(button.id, 'child');
  assert.equal(button.title, 'Child');
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(emitted, ['Ready']);
  app.unmount();

  const NoFallthrough = {
    props: ['label'],
    inheritAttrs: false,
    setup(props, { attrs }) {
      return () => h('span', {}, `${props.label}:${Object.keys(attrs).length}`);
    }
  };
  render(h(NoFallthrough, { label: 'Hidden', id: 'ignored' }), root);
  assert.equal(root.querySelector('span').id, '');
  assert.equal(root.textContent, 'Hidden:1');
});

test('object components validate object emits and normalize kebab-case listeners', () => {
  const document = installDom();
  const root = document.createElement('main');
  const received = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = warning => warnings.push(String(warning));
  try {
    const Child = {
      props: [],
      emits: { 'save-item': value => typeof value === 'number' },
      setup(_props, { attrs, emit }) {
        return () => h('button', { title: attrs.title, onClick: () => emit('save-item', 'invalid') }, 'Save');
      }
    };
    render(h(Child, { title: 'attribute', onSaveItem: value => received.push(value) }), root);
    const button = root.querySelector('button');
    button.dispatchEvent(new Event('click'));
    assert.deepEqual(received, ['invalid']);
    assert.equal(button.title, 'attribute');
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test('object component setup exposes reactive default and named slots', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = {
    setup(_props, { slots }) {
      return () => h('article', {}, [
        h('header', {}, slots.header?.() ?? []),
        h('main', {}, slots.default?.() ?? [])
      ]);
    }
  };
  const render = state => h(Panel, {}, [
    h('h1', { slot: 'header' }, state.title),
    h('p', {}, state.body)
  ]);
  const state = createApp(render, { title: 'Title', body: 'Body' }).mount(root);
  const heading = root.querySelector('h1');
  const paragraph = root.querySelector('p');
  assert.equal(heading.textContent, 'Title');
  assert.equal(paragraph.textContent, 'Body');
  state.title = 'Updated title';
  state.body = 'Updated body';
  await nextTick();
  assert.equal(root.querySelector('h1'), heading);
  assert.equal(root.querySelector('p'), paragraph);
  assert.equal(heading.textContent, 'Updated title');
  assert.equal(paragraph.textContent, 'Updated body');
});

test('object component slots expose names added after setup', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Panel = {
    setup(_props, { slots }) {
      return () => {
        const extra = slots.extra?.() ?? [];
        return h('article', {}, extra.length ? extra : [h('em', {}, 'No extra')]);
      };
    }
  };
  const render = state => h(Panel, {}, state.extra
    ? [h('strong', { slot: 'extra' }, state.extra)]
    : []);
  const state = createApp(render, { extra: '' }).mount(root);
  assert.equal(root.querySelector('em').textContent, 'No extra');
  state.extra = 'Added';
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Added');
  state.extra = '';
  await nextTick();
  assert.equal(root.querySelector('em').textContent, 'No extra');
});

test('virtual DOM performs keyed moves and insertions while updating props and listeners', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let clicks = 0;
  const first = createApp(state => h('ul', { class: state.active ? 'active' : 'idle', style: { color: state.color } }, [
    ...state.items.map(item => h('li', { key: item.id, onClick: () => clicks++ }, item.label))
  ]), { active: false, color: 'red', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  const state = first.mount(root);
  const originalA = root.querySelectorAll('li')[0];
  const originalB = root.querySelectorAll('li')[1];

  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  state.active = true;
  state.color = 'blue';
  await nextTick();

  const items = root.querySelectorAll('li');
  assert.equal(items.length, 3);
  assert.equal(items[0], originalB);
  assert.equal(items[1], originalA);
  assert.equal(items[0].textContent, 'B2');
  assert.equal(root.querySelector('ul').className, 'active');
  assert.equal(root.querySelector('ul').style.color, 'blue');
  items[0].dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(clicks, 1);
});

test('virtual DOM creates SVG trees in the SVG namespace', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = createApp(state => h('svg', { viewBox: state.viewBox }, [
    h('g', {}, [h('circle', { cx: 4, cy: 5, r: state.radius })])
  ]), { viewBox: '0 0 10 10', radius: 2 }).mount(root);
  const svg = root.querySelector('svg');
  const circle = root.querySelector('circle');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(circle.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(circle.getAttribute('r'), '2');
  state.radius = 3;
  state.viewBox = '0 0 20 20';
  await nextTick();
  assert.equal(root.querySelector('circle'), circle);
  assert.equal(circle.getAttribute('r'), '3');
  assert.equal(svg.getAttribute('viewBox'), '0 0 20 20');
});

test('virtual DOM switches to HTML namespace inside SVG foreignObject', () => {
  const document = installDom();
  const root = document.createElement('main');
  render(h('svg', {}, [h('foreignObject', {}, [h('div', { class: 'embedded' }, [h('input', { type: 'text' })])])]), root);
  const foreignObject = root.querySelector('foreignObject');
  const embedded = root.querySelector('.embedded');
  const input = root.querySelector('input');
  assert.equal(foreignObject.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(embedded.namespaceURI, 'http://www.w3.org/1999/xhtml');
  assert.equal(input.namespaceURI, 'http://www.w3.org/1999/xhtml');
});

test('virtual DOM removes stale event listeners and style properties', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let oldClicks = 0;
  let newClicks = 0;
  const app = createApp(state => h('button', {
    onClick: state.version === 0 ? () => oldClicks++ : () => newClicks++,
    style: state.version === 0 ? { color: 'red', background: 'white' } : { color: 'green' }
  }, 'go'), { version: 0 });
  const state = app.mount(root);
  const button = root.querySelector('button');
  state.version = 1;
  await nextTick();
  button.dispatchEvent(new Event('click'));
  assert.equal(oldClicks, 0);
  assert.equal(newClicks, 1);
  assert.equal(button.style.color, 'green');
  assert.equal(button.style.background, '');
  app.replaceRender(() => h('button', {}, 'go'));
  button.dispatchEvent(new Event('click'));
  assert.equal(newClicks, 1);
  app.unmount();
});

test('virtual DOM parses Vue event option suffixes', () => {
  const document = installDom();
  const root = document.createElement('main');
  const calls = [];
  const app = createApp(() => h('div', { onClickCapture: () => calls.push('capture') }, [
    h('button', { onClick: () => calls.push('bubble') }, 'bubble'),
    h('button', { onClickOnce: () => calls.push('once') }, 'once')
  ]));
  app.mount(root);
  const [bubble, once] = root.querySelectorAll('button');
  bubble.dispatchEvent(new Event('click', { bubbles: true }));
  once.dispatchEvent(new Event('click', { bubbles: true }));
  once.dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(calls, ['capture', 'bubble', 'capture', 'once', 'capture']);
  app.unmount();
});

test('runtime-dom normalizes class and style values and invokes event arrays', () => {
  const document = installDom();
  const root = document.createElement('main');
  let calls = 0;
  const first = h('button', {
    class: ['base', { active: true }, ['nested']],
    style: [{ color: 'red' }, 'display: block;'],
    onClick: [() => calls++, () => calls += 2]
  }, 'Run');
  render(first, root);
  const button = root.querySelector('button');
  assert.equal(button.className, 'base active nested');
  assert.equal(button.style.color, 'red');
  assert.equal(button.style.display, 'block');
  button.dispatchEvent(new Event('click'));
  assert.equal(calls, 3);
  render(h('button', { class: { active: false, next: true }, style: 'color: blue;' }, 'Run'), root);
  assert.equal(button.className, 'next');
  assert.equal(button.style.color, 'blue');
  assert.equal(button.style.display, '');
  button.dispatchEvent(new Event('click'));
  assert.equal(calls, 3);
});

test('SFC render tracks state, loops keyed children, and writes v-model values back', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <section>
        <strong>{{count}}</strong>
        <button v-if="visible" @click="increment()">inc</button>
        <em v-else>hidden</em>
        <ul><li v-for="item in items" :key="item.id">{{item.label}}</li></ul>
        <input v-model="name">
      </section>
    </template>
  `);
  const state = createApp(render, {
    count: 0,
    visible: true,
    name: 'Ada',
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    increment() { this.count++; }
  }).mount(root);
  assert.equal(root.querySelector('strong').textContent, '0');
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '1');
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('em').textContent, 'hidden');
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['B2', 'A']);
  const input = root.querySelector('input');
  input.value = 'Grace';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.name, 'Grace');
});

test('SFC string refs bind setup refs without leaking DOM attributes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Component = compileSfcComponent(`
    <template>
      <section>
        <input ref="input">
        <strong>{{ input ? 'bound' : 'empty' }}</strong>
        <small>{{ tick }}</small>
        <button @click="touch">touch</button>
      </section>
    </template>
    <script setup>
      const input = ref(null);
      const tick = ref(0);
      function touch() { tick.value++; }
    </script>
  `);
  const app = createApp(() => h(Component));
  app.mount(root);
  const input = root.querySelector('input');
  assert.equal(input.hasAttribute('ref'), false);
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'empty');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'bound');
  app.unmount();
});

test('SFC refs inside v-for collect keyed nodes in DOM order', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Component = compileSfcComponent(`
    <template>
      <section>
        <ul><li v-for="item in items" :key="item.id" ref="rows">{{ item.label }}</li></ul>
        <small>{{ tick }}:{{ rows.length }}</small>
        <button @click="touch">touch</button>
      </section>
    </template>
    <script setup>
      const rows = ref([]);
      const tick = ref(0);
      function touch() { tick.value++; }
    </script>
  `);
  const app = createApp(state => h(Component, { items: state.items }), {
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  });
  const state = app.mount(root);
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.deepEqual(state.items, [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
  assert.equal(root.querySelector('small').textContent, '1:2');
  const firstRows = [...root.querySelectorAll('li')];
  state.items = [{ id: 'b', label: 'B2' }, { id: 'c', label: 'C' }];
  await nextTick();
  const updatedRows = [...root.querySelectorAll('li')];
  assert.equal(updatedRows[0], firstRows[1]);
  assert.notEqual(updatedRows[1], firstRows[0]);
  assert.deepEqual(updatedRows.map(row => row.textContent), ['B2', 'C']);
  assert.equal(root.querySelector('small').textContent, '1:2');
  app.unmount();
});

test('SFC template blocks render v-for and conditional fragments without DOM wrappers', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Component = compileSfcComponent(`
    <template>
      <section>
        <template v-if="visible"><strong>shown</strong><em>now</em></template>
        <template v-else><strong>hidden</strong></template>
        <ul><template v-for="item in items"><li :key="item.id">{{ item.label }}</li></template></ul>
        <button @click="toggle">toggle</button>
      </section>
    </template>
    <script setup>
      const visible = ref(true);
      function toggle() { visible.value = !visible.value; }
    </script>
  `);
  const app = createApp(state => h(Component, { items: state.items }), {
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  });
  const state = app.mount(root);
  assert.equal(root.querySelector('section').children[0].tagName, 'STRONG');
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A', 'B']);
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'hidden');
  assert.equal(root.querySelector('em'), null);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'c', label: 'C' }];
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['B2', 'C']);
  app.unmount();
});

test('SFC v-for supports numeric ranges and object value-key-index aliases', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Component = compileSfcComponent(`
    <template>
      <section>
        <ol><li v-for="n in 3">{{ n }}</li></ol>
        <dl><template v-for="(value, key, index) in records"><dt>{{ key }}={{ value }}:{{ index }}</dt></template></dl>
      </section>
    </template>
    <script setup></script>
  `);
  const app = createApp(state => h(Component, { records: state.records }), {
    records: { first: 'A', second: 'B' }
  });
  app.mount(root);
  assert.deepEqual([...root.querySelectorAll('ol li')].map(node => node.textContent), ['1', '2', '3']);
  assert.deepEqual([...root.querySelectorAll('dt')].map(node => node.textContent), ['first=A:0', 'second=B:1']);
  app.unmount();
});

test('SFC v-once caches static subtrees while dynamic siblings continue updating', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('sfc-v-once-test', compileSfcComponent(`
    <template><section><strong v-once>{{ label }}</strong><span>{{ count }}</span><button @click="increment">go</button></section></template>
    <script setup>
      const label = ref('Initial');
      const count = ref(0);
      function increment() { count.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  const span = root.querySelector('span');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, 'Initial');
  assert.equal(root.querySelector('span'), span);
  assert.equal(span.textContent, '1');
  app.unmount();

  const hmrRoot = document.createElement('main');
  const Hmr = defineComponent('sfc-v-once-hmr-test', compileSfcComponent('<template><strong v-once>Before</strong></template>'));
  const hmrApp = createApp(() => h(Hmr));
  hmrApp.mount(hmrRoot);
  assert.equal(hotUpdate('sfc-v-once-hmr-test', compileSfcComponent('<template><strong v-once>After</strong></template>')), true);
  assert.equal(hmrRoot.textContent, 'After');
  hmrApp.unmount();
});

test('SFC v-memo skips a subtree until its dependency array changes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Counter = defineComponent('sfc-v-memo-test', compileSfcComponent(`
    <template><section><strong v-memo="[version]">{{ count }}</strong><button @click="increment">go</button><button @click="refresh">refresh</button></section></template>
    <script setup>
      const count = ref(0);
      const version = ref(0);
      function increment() { count.value++; }
      function refresh() { version.value++; }
    </script>
  `));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  const [increment, refresh] = root.querySelectorAll('button');
  increment.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, '0');
  refresh.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(strong.textContent, '1');
  app.unmount();
});

test('withMemo reuses VNodes by dependency identity', () => {
  const cache = [];
  let renders = 0;
  const renderMemo = value => withMemo([value], () => {
    renders++;
    return h('strong', {}, String(value));
  }, cache, 0);
  const first = renderMemo(1);
  const second = renderMemo(1);
  const third = renderMemo(2);
  assert.equal(first, second);
  assert.notEqual(second, third);
  assert.equal(renders, 2);
  assert.equal(isMemoSame(third, [2]), true);
  assert.equal(isMemoSame(third, [1]), false);
});

test('SFC hoists static subtrees and invalidates them during template HMR', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const script = `
      const count = ref(0);
      function increment() { count.value++; }
    `;
  const Counter = defineComponent('sfc-static-hoist-test', compileSfcComponent(`<template><section><strong>Before</strong><span>{{ count }}</span><button @click="increment">go</button></section></template><script setup>${script}</script>`));
  const app = createApp(() => h(Counter));
  app.mount(root);
  const strong = root.querySelector('strong');
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong'), strong);
  assert.equal(root.querySelector('span').textContent, '1');
  assert.equal(hotUpdate('sfc-static-hoist-test', compileSfcComponent(`<template><section><strong>After</strong><span>{{ count }}</span><button @click="increment">go</button></section></template><script setup>${script}</script>`)), true);
  assert.equal(root.querySelector('strong').textContent, 'After');
  app.unmount();
});

test('SFC v-model handles checkbox and radio values and event arguments', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input type="checkbox" v-model="enabled">
        <input type="radio" value="a" v-model="choice">
        <input type="radio" value="b" v-model="choice">
        <button @click="choose('done')">choose</button>
      </div>
    </template>
  `);
  const state = createApp(render, {
    enabled: false,
    choice: 'a',
    result: '',
    choose(value) { this.result = value; }
  }).mount(root);
  const [checkbox, radioA, radioB, button] = root.querySelectorAll('input,button');
  assert.equal(checkbox.checked, false);
  assert.equal(radioA.checked, true);
  assert.equal(radioB.checked, false);
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
  radioB.checked = true;
  radioB.dispatchEvent(new Event('change', { bubbles: true }));
  button.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.enabled, true);
  assert.equal(state.choice, 'b');
  assert.equal(state.result, 'done');
});

test('SFC v-model modifiers trim, coerce numbers, and defer lazy updates', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input v-model.trim.number="amount">
        <input v-model.lazy="draft">
        <select v-model.number="choice"><option value="1">One</option><option value="2">Two</option></select>
      </div>
    </template>
  `);
  const state = createApp(render, { amount: 0, draft: 'old', choice: 1 }).mount(root);
  const [amount, draft] = root.querySelectorAll('input');
  const select = root.querySelector('select');
  amount.value = ' 42 ';
  amount.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.amount, 42);
  draft.value = 'new';
  draft.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.draft, 'old');
  draft.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.draft, 'new');
  select.value = '2';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.choice, 2);
});

test('SFC event handlers accept literal and $event arguments', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><div><button @click="setValue(7)">literal</button><button @click="setEvent($event)">event</button></div></template>');
  const state = createApp(render, {
    value: 0,
    event: null,
    setValue(value) { this.value = value; },
    setEvent(value) { this.event = value; }
  }).mount(root);
  const [literal, eventButton] = root.querySelectorAll('button');
  literal.dispatchEvent(new Event('click', { bubbles: true }));
  const event = new Event('click', { bubbles: true });
  eventButton.dispatchEvent(event);
  assert.equal(state.value, 7);
  assert.equal(state.event, event);
});

test('SFC event modifiers prevent, stop, filter, and limit handlers', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div @click="parent" @click.self="self">
        <button @click.prevent.stop="child">Child</button>
        <button v-on:click.once="once">Once</button>
      </div>
    </template>
  `);
  const state = createApp(render, {
    parentRuns: 0, selfRuns: 0, childRuns: 0, onceRuns: 0,
    parent() { this.parentRuns++; },
    self() { this.selfRuns++; },
    child() { this.childRuns++; },
    once() { this.onceRuns++; }
  }).mount(root);
  const [child, once] = root.querySelectorAll('button');
  const childEvent = new Event('click', { bubbles: true, cancelable: true });
  child.dispatchEvent(childEvent);
  assert.equal(childEvent.defaultPrevented, true);
  assert.equal(state.childRuns, 1);
  assert.equal(state.parentRuns, 0);
  assert.equal(state.selfRuns, 0);
  once.dispatchEvent(new Event('click', { bubbles: true }));
  once.dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.onceRuns, 1);
});

test('SFC capture event modifier runs before bubbling handlers', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div @click.capture="capture">
        <button @click="bubble">Click</button>
      </div>
    </template>
  `);
  const state = createApp(render, {
    calls: [],
    capture() { this.calls.push('capture'); },
    bubble() { this.calls.push('bubble'); }
  }).mount(root);
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(state.calls, ['capture', 'bubble']);
});

test('SFC event modifiers filter keyboard, mouse, and system inputs', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input @keyup.enter="enter" @keyup.ctrl.exact="ctrl">
        <button @click.right="right">Right</button>
      </div>
    </template>
  `);
  const state = createApp(render, { enterRuns: 0, ctrlRuns: 0, rightRuns: 0,
    enter() { this.enterRuns++; }, ctrl() { this.ctrlRuns++; }, right() { this.rightRuns++; } }).mount(root);
  const input = root.querySelector('input');
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true, bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true }));
  assert.equal(state.enterRuns, 3);
  assert.equal(state.ctrlRuns, 1);
  const button = root.querySelector('button');
  button.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }));
  button.dispatchEvent(new MouseEvent('click', { button: 2, bubbles: true }));
  assert.equal(state.rightRuns, 1);
});

test('SFC resolves dynamic attribute and event arguments', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><button :[attribute]="value" v-on:[eventName]="handle">Dynamic</button></template>');
  const state = createApp(render, {
    attribute: 'title', value: 'First', eventName: 'click', runs: 0,
    handle() { this.runs++; }
  }).mount(root);
  const button = root.querySelector('button');
  assert.equal(button.title, 'First');
  button.dispatchEvent(new Event('click'));
  assert.equal(state.runs, 1);
  state.attribute = 'aria-label';
  state.value = 'Second';
  state.eventName = 'dblclick';
  await nextTick();
  assert.equal(button.getAttribute('aria-label'), 'Second');
  button.dispatchEvent(new Event('click'));
  button.dispatchEvent(new Event('dblclick'));
  assert.equal(state.runs, 2);
});

test('SFC v-model supports checkbox arrays and select values', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template>
      <div>
        <input type="checkbox" value="a" v-model="tags">
        <input type="checkbox" value="b" v-model="tags">
        <select v-model="choice"><option value="a">A</option><option value="b">B</option></select>
        <select multiple v-model="selected"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>
      </div>
    </template>
  `);
  const state = createApp(render, { tags: ['a'], choice: 'b', selected: ['a', 'c'] }).mount(root);
  const [tagA, tagB] = root.querySelectorAll('input');
  const [choice, selected] = root.querySelectorAll('select');
  assert.equal(tagA.checked, true);
  assert.equal(tagB.checked, false);
  assert.equal(choice.value, 'b');
  assert.deepEqual([...selected.selectedOptions].map(option => option.value), ['a', 'c']);
  tagB.checked = true;
  tagB.dispatchEvent(new Event('change', { bubbles: true }));
  tagA.checked = false;
  tagA.dispatchEvent(new Event('change', { bubbles: true }));
  choice.value = 'a';
  choice.dispatchEvent(new Event('change', { bubbles: true }));
  Object.defineProperty(selected, 'selectedOptions', { configurable: true, value: [selected.options[1]] });
  selected.dispatchEvent(new Event('change', { bubbles: true }));
  assert.deepEqual(state.tags, ['b']);
  assert.equal(state.choice, 'a');
  assert.deepEqual(state.selected, ['b']);
  delete selected.selectedOptions;
  await nextTick();
});

test('SFC v-for accepts tuple syntax and preserves keyed form nodes', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><ul><li v-for="(item, index) of items" :key="item.id"><input :value="item.label"><span>{{index}}:{{item.label}}</span></li></ul></template>');
  const state = createApp(render, {
    items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]
  }).mount(root);
  const [inputA, inputB] = root.querySelectorAll('input');
  inputB.value = 'Typing';
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }];
  await nextTick();
  const [first, second] = root.querySelectorAll('input');
  assert.equal(first, inputB);
  assert.equal(second, inputA);
  assert.equal(first.value, 'B2');
  assert.deepEqual([...root.querySelectorAll('span')].map(node => node.textContent), ['0:B2', '1:A']);
});

test('SFC evaluates v-else-if chains in sibling order', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><div><p v-if="mode === 1">one</p><p v-else-if="mode === 2">two</p><p v-else>other</p></div></template>');
  const state = createApp(render, { mode: 1 }).mount(root);
  assert.equal(root.querySelector('p').textContent, 'one');
  state.mode = 2;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'two');
  state.mode = 3;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'other');
});

test('SFC v-html replaces child VNodes and virtual DOM restores them cleanly', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent('<template><section><div v-html="markup"><span>Ignored</span></div></section></template>');
  const state = createApp(render, { markup: '<strong>One</strong>' }).mount(root);
  const target = root.querySelector('div');
  assert.equal(target.innerHTML, '<strong>One</strong>');
  assert.equal(target.querySelector('span'), null);
  state.markup = '<em>Two</em>';
  await nextTick();
  assert.equal(target.innerHTML, '<em>Two</em>');

  const treeState = reactive({ raw: true, markup: '<b>Raw</b>' });
  const treeRoot = document.createElement('main');
  const app = createApp(state => h('div', state.raw ? { innerHTML: state.markup } : {}, state.raw ? [] : [h('span', {}, 'VNode')]), treeState);
  app.mount(treeRoot);
  treeState.raw = false;
  await nextTick();
  assert.equal(treeRoot.querySelector('div').innerHTML, '<span>VNode</span>');
  treeState.raw = true;
  treeState.markup = '<i>Again</i>';
  await nextTick();
  assert.equal(treeRoot.querySelector('div').innerHTML, '<i>Again</i>');
});

test('SFC resolves registered child components into the VDOM tree', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-child-test', props => h('strong', { class: 'child' }, String(props.label)));
  const render = compileSfcComponent('<template><section><Child :label="message" /></section></template>');
  const state = createApp(render, { message: 'Before', components: { Child } }).mount(root);
  const child = root.querySelector('strong');
  assert.equal(child.textContent, 'Before');
  state.message = 'After';
  await nextTick();
  assert.equal(root.querySelector('strong'), child);
  assert.equal(child.textContent, 'After');
});

test('SFC renders named slots, direct slot content, and slot fallbacks', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Card = compileSfcComponent(`
    <template>
      <article>
        <header><slot name="header"><h1>Fallback header</h1></slot></header>
        <main><slot><p>Fallback body</p></slot></main>
        <footer><slot name="footer"><small>Fallback footer</small></slot></footer>
      </article>
    </template>
  `);
  const render = compileSfcComponent(`
    <template>
      <Card>
        <template v-slot:header><h2>{{ title }}</h2></template>
        <p slot="footer">{{ footer }}</p>
        <strong>{{ body }}</strong>
      </Card>
    </template>
  `);
  const state = createApp(render, {
    title: 'Heading', body: 'Body', footer: 'Footer', components: { Card }
  }).mount(root);
  assert.equal(root.querySelector('h2').textContent, 'Heading');
  assert.equal(root.querySelector('main strong').textContent, 'Body');
  assert.equal(root.querySelector('footer p').textContent, 'Footer');
  assert.equal(root.querySelector('small'), null);
  state.title = 'Updated';
  await nextTick();
  assert.equal(root.querySelector('h2').textContent, 'Updated');

  const fallbackRoot = document.createElement('main');
  createApp(() => h(Card)).mount(fallbackRoot);
  assert.equal(fallbackRoot.querySelector('h1').textContent, 'Fallback header');
  assert.equal(fallbackRoot.querySelector('main p').textContent, 'Fallback body');
  assert.equal(fallbackRoot.querySelector('small').textContent, 'Fallback footer');
});

test('SFC scoped slots receive child props and retain the parent render scope', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Card = compileSfcComponent(`
    <template><article><slot name="item" :label="label"><em>Fallback</em></slot></article></template>
  `);
  const render = compileSfcComponent(`
    <template>
      <Card :label="label">
        <template #item="slotProps"><strong>{{ slotProps.label }}:{{ suffix }}</strong></template>
      </Card>
    </template>
  `);
  const state = createApp(render, {
    label: 'First', suffix: 'one', components: { Card }
  }).mount(root);
  const content = root.querySelector('strong');
  assert.equal(content.textContent, 'First:one');
  state.label = 'Second';
  await nextTick();
  assert.equal(root.querySelector('strong'), content);
  assert.equal(content.textContent, 'Second:one');
  state.suffix = 'two';
  await nextTick();
  assert.equal(root.querySelector('strong'), content);
  assert.equal(content.textContent, 'Second:two');
});

test('SFC component-level v-slot provides default scoped slot props', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Card = compileSfcComponent('<template><article><slot :label="label" /></article></template>');
  const render = compileSfcComponent('<template><Card :label="label" v-slot="slotProps"><strong>{{ slotProps.label }}</strong></Card></template>');
  const state = createApp(render, { label: 'Initial', components: { Card } }).mount(root);
  const content = root.querySelector('strong');
  assert.equal(content.textContent, 'Initial');
  state.label = 'Changed';
  await nextTick();
  assert.equal(content.textContent, 'Changed');
});

test('SFC dynamic slot names preserve expressions and update their receiving outlet', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Card = compileSfcComponent('<template><article><slot :name="activeSlot"><em>Fallback</em></slot></article></template>');
  const render = compileSfcComponent('<template><Card :activeSlot="activeSlot"><template v-slot:[activeSlot]><strong>{{ message }}</strong></template></Card></template>');
  const state = createApp(render, { activeSlot: 'first', message: 'One', components: { Card } }).mount(root);
  assert.equal(root.querySelector('strong').textContent, 'One');
  state.activeSlot = 'second';
  state.message = 'Two';
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Two');
  assert.equal(root.querySelector('em'), null);
});

test('SFC resolves dynamic native and registered component targets', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('dynamic-child-test', () => h('strong', {}, 'Child'));
  const render = compileSfcComponent('<template><component :is="current">Dynamic</component></template>');
  const state = createApp(render, { current: 'em', components: { Child } }).mount(root);
  assert.equal(root.querySelector('em').textContent, 'Dynamic');
  state.current = Child;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Child');
});

test('SFC self-closing components preserve following sibling boundaries', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-self-closing-test', () => h('i', {}, 'Child'));
  const render = compileSfcComponent('<template><section><Child /><strong>Sibling</strong></section></template>');
  createApp(() => h(render, { components: { Child } })).mount(root);
  assert.equal(root.querySelector('i').textContent, 'Child');
  assert.equal(root.querySelector('strong').textContent, 'Sibling');
  assert.equal(root.querySelector('i').nextElementSibling, root.querySelector('strong'));
});

test('SFC component props and emits normalize kebab-case names', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = {
    props: { userName: String },
    emits: ['save-event'],
    setup(props, { emit }) {
      return () => h('button', { onClick: () => emit('save-event', props.userName) }, props.userName);
    }
  };
  const render = compileSfcComponent('<template><section><Child user-name="Ada" @save-event="handle"></Child><strong>{{ result }}</strong></section></template>');
  createApp(state => h(render, { components: { Child }, result: state.result, handle: value => { state.result = value; } }), { result: 'none' }).mount(root);
  assert.equal(root.querySelector('button').textContent, 'Ada');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Ada');
});

test('SFC supports object spread bindings for native and child component props', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-bind-test', props => h('strong', {}, `${props.label}:${props.active}`));
  const render = compileSfcComponent('<template><div><input v-bind="inputProps"><Child v-bind="childProps" /></div></template>');
  const state = createApp(render, {
    inputProps: { title: 'Editor', value: 'draft' },
    childProps: { label: 'Ready', active: true },
    components: { Child }
  }).mount(root);
  const input = root.querySelector('input');
  assert.equal(input.title, 'Editor');
  assert.equal(input.value, 'draft');
  assert.equal(root.querySelector('strong').textContent, 'Ready:true');
  state.childProps = { label: 'Done', active: false };
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Done:false');
});

test('SFC v-on object bindings update native and component event listeners', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = defineComponent('sfc-v-on-object-child', {
    emits: ['save'],
    setup(_props, { emit }) {
      return () => h('button', { class: 'child', onClick: () => emit('save', 3) }, 'Save');
    }
  });
  const render = compileSfcComponent(`
    <template><section><button class="native" v-on="nativeListeners">Native</button><Child v-on="componentListeners" /></section></template>
  `);
  const state = createApp(render, {
    components: { Child },
    nativeCount: 0,
    saved: 0,
    nativeListeners: { click() { this.nativeCount++; } },
    componentListeners: { save(value) { this.saved += value; } }
  }).mount(root);
  root.querySelector('.native').dispatchEvent(new Event('click', { bubbles: true }));
  root.querySelector('.child').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.nativeCount, 1);
  assert.equal(state.saved, 3);

  state.nativeListeners = { click() { this.nativeCount += 2; } };
  state.componentListeners = { save(value) { this.saved += value * 2; } };
  await nextTick();
  root.querySelector('.native').dispatchEvent(new Event('click', { bubbles: true }));
  root.querySelector('.child').dispatchEvent(new Event('click', { bubbles: true }));
  assert.equal(state.nativeCount, 3);
  assert.equal(state.saved, 9);
});

test('SFC custom directives use the VNode directive lifecycle and modifiers', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const events = [];
  const focus = {
    mounted(element, binding) {
      events.push(`mounted:${binding.value}:${binding.arg}:${binding.modifiers.trim}`);
      element.setAttribute('data-focus', String(binding.value));
    },
    updated(element, binding) {
      events.push(`updated:${binding.oldValue}->${binding.value}`);
      element.setAttribute('data-focus', String(binding.value));
    }
  };
  const render = compileSfcComponent('<template><input v-focus:field.trim="message"></template>');
  const state = createApp(render, { message: 'Ready', directives: { focus } }).mount(root);
  const input = root.querySelector('input');
  assert.equal(input.getAttribute('data-focus'), 'Ready');
  assert.deepEqual(events, ['mounted:Ready:field:true']);
  state.message = 'Updated';
  await nextTick();
  assert.equal(input.getAttribute('data-focus'), 'Updated');
  assert.deepEqual(events, ['mounted:Ready:field:true', 'updated:Ready->Updated']);
});

test('SFC v-model uses the Vue component modelValue update contract', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Editor = defineComponent('sfc-model-component-test', {
    props: { modelValue: String },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => h('button', { onClick: () => emit('update:modelValue', `${props.modelValue}!`) }, props.modelValue);
    }
  });
  const render = compileSfcComponent('<template><section><Editor v-model="message"></Editor><strong>{{ message }}</strong></section></template><script setup>const message = ref(\'Ready\');</script>');
  createApp(() => h(render, { components: { Editor } })).mount(root);
  assert.equal(root.querySelector('button').textContent, 'Ready');
  assert.equal(root.querySelector('strong').textContent, 'Ready');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Ready!');
});

test('SFC v-model supports named component models and modifiers', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Editor = defineComponent('sfc-named-model-test', {
    props: { title: String, titleModifiers: Object },
    emits: ['update:title'],
    setup(props, { emit }) {
      return () => h('button', { onClick: () => emit('update:title', `${props.title}!`) }, `${props.title}:${props.titleModifiers?.trim}`);
    }
  });
  const render = compileSfcComponent('<template><section><Editor v-model:title.trim="title"></Editor><strong>{{ title }}</strong></section></template><script setup>const title = ref(\'Ready\');</script>');
  createApp(() => h(render, { components: { Editor } })).mount(root);
  assert.equal(root.querySelector('button').textContent, 'Ready:true');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'Ready!');
});

test('SFC component v-model leaves modifier normalization to the child', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Editor = defineComponent('sfc-model-modifier-boundary-test', {
    props: { modelValue: String, modelModifiers: Object },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => h('button', { onClick: () => emit('update:modelValue', '  raw  ') }, `${props.modelModifiers?.trim}`);
    }
  });
  const render = compileSfcComponent('<template><section><Editor v-model.trim="message"></Editor><strong>{{ message }}</strong></section></template><script setup>const message = ref(\'Ready\');</script>');
  createApp(() => h(render, { components: { Editor } })).mount(root);
  assert.equal(root.querySelector('button').textContent, 'true');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '  raw  ');
});

test('SFC expressions can call methods on scoped reactive values', () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template><section><strong>{{ labels.join('-') }}</strong><em>{{ labels.includes(active) ? 'yes' : 'no' }}</em></section></template>
    <script setup>
      const labels = ref(['A', 'B']);
      const active = ref('B');
    </script>
  `);
  createApp(() => h(render)).mount(root);
  assert.equal(root.querySelector('strong').textContent, 'A-B');
  assert.equal(root.querySelector('em').textContent, 'yes');
});

test('SFC event expressions execute updates lazily with $event scope', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const render = compileSfcComponent(`
    <template><section><strong>{{ count }}</strong><em>{{ labels.join(',') }}</em><p>{{ message }}</p><button @click="count++">increment</button><button @click="labels.push($event.detail)">append</button><button @click="count += 2">add</button><button @click="message = $event.detail">message</button></section></template>
    <script setup>
      const count = ref(0);
      const labels = ref(['A']);
      const message = ref('empty');
    </script>
  `);
  createApp(() => h(render)).mount(root);
  root.querySelectorAll('button')[0].dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '1');
  root.querySelectorAll('button')[1].dispatchEvent(new CustomEvent('click', { detail: 'B' }));
  await nextTick();
  assert.equal(root.querySelector('em').textContent, 'A,B');
  root.querySelectorAll('button')[2].dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '3');
  root.querySelectorAll('button')[3].dispatchEvent(new CustomEvent('click', { detail: 'ready' }));
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'ready');
});

test('SFC script setup compiles safe reactive declarations and event methods', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const saves = [];
  const component = compileSfcComponent(`
    <template>
      <section>
        <input v-model="count">
        <strong>{{ count }} / {{ doubled }}</strong>
        <button @click="increment">Increment</button>
        <button @click="save">Save</button>
      </section>
    </template>
    <script setup>
      const count = ref(1);
      const doubled = computed(() => count * 2);
      function increment() { count.value++; }
      const save = () => emit('save', count.value);
    </script>
  `);
  const app = createApp(() => h(component, { onSave: value => saves.push(value) }));
  app.mount(root);
  const input = root.querySelector('input');
  const [increment, save] = root.querySelectorAll('button');
  assert.equal(root.querySelector('strong').textContent, '1 / 2');
  increment.dispatchEvent(new Event('click', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '2 / 4');
  input.value = '3';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '3 / 6');
  save.dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(saves, ['3']);
  app.unmount();
});

test('hydrates Thymeleaf bindings and synchronizes model values', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<span data-tr-text="user.name"></span><input data-tr-model="user.name"><div data-tr-show="visible"></div>';
  const state = hydrate(root, { user: { name: 'Ada' }, visible: false });
  assert.equal(root.querySelector('span').textContent, 'Ada');
  assert.equal(root.querySelector('div').hidden, true);
  state.user.name = 'Grace';
  await nextTick();
  assert.equal(root.querySelector('span').textContent, 'Grace');
  const input = root.querySelector('input');
  input.value = 'Lin';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(state.user.name, 'Lin');
});

test('hydrates checkbox radio and multiple-select model bindings', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = [
    '<input type="checkbox" data-tr-model="enabled">',
    '<input type="checkbox" value="a" data-tr-model="tags">',
    '<input type="checkbox" value="b" data-tr-model="tags">',
    '<input type="radio" name="choice" value="a" data-tr-model="choice">',
    '<input type="radio" name="choice" value="b" data-tr-model="choice">',
    '<select multiple data-tr-model="selected"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>'
  ].join('');
  const state = hydrate(root, { enabled: true, tags: ['a'], choice: 'b', selected: ['b', 'c'] });
  const [enabled, tagA, tagB, choiceA, choiceB] = root.querySelectorAll('input');
  const select = root.querySelector('select');
  assert.equal(enabled.checked, true);
  assert.equal(tagA.checked, true);
  assert.equal(tagB.checked, false);
  assert.equal(choiceA.checked, false);
  assert.equal(choiceB.checked, true);
  assert.deepEqual([...select.selectedOptions].map(option => option.value), ['b', 'c']);

  enabled.checked = false;
  enabled.dispatchEvent(new Event('change', { bubbles: true }));
  tagB.checked = true;
  tagB.dispatchEvent(new Event('change', { bubbles: true }));
  choiceA.checked = true;
  choiceA.dispatchEvent(new Event('change', { bubbles: true }));
  Object.defineProperty(select, 'selectedOptions', { configurable: true, value: [select.options[0]] });
  select.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(state.enabled, false);
  assert.deepEqual(state.tags, ['a', 'b']);
  assert.equal(state.choice, 'a');
  assert.deepEqual(state.selected, ['a']);
  delete select.selectedOptions;

  state.tags = ['b'];
  state.choice = 'b';
  state.selected = ['c'];
  await nextTick();
  assert.equal(tagA.checked, false);
  assert.equal(tagB.checked, true);
  assert.equal(choiceA.checked, false);
  assert.equal(choiceB.checked, true);
  assert.deepEqual([...select.options].filter(option => option.selected).map(option => option.value), ['c']);
});

test('hydrates dynamic attributes, classes, and styles reactively', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<a data-tr-attr="title:user.name,aria-label:user.name" data-tr-class="classes" data-tr-style="styles">Link</a>';
  const state = hydrate(root, {
    user: { name: 'Ada' },
    classes: { active: true, muted: false },
    styles: { color: 'red', display: 'block' }
  });
  const link = root.querySelector('a');
  assert.equal(link.getAttribute('title'), 'Ada');
  assert.equal(link.getAttribute('aria-label'), 'Ada');
  assert.equal(link.className, 'active');
  assert.equal(link.style.color, 'red');
  state.user.name = 'Grace';
  state.classes = { active: false, muted: true };
  state.styles = { color: 'blue' };
  await nextTick();
  assert.equal(link.getAttribute('title'), 'Grace');
  assert.equal(link.className, 'muted');
  assert.equal(link.style.color, 'blue');
  assert.equal(link.style.display, '');
});

test('hydration removes stale dynamic attrs and normalizes nested class values', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<a class="server-class" style="font-weight: bold" data-tr-attr="attrs" data-tr-class="classes" data-tr-style="styles" data-static="keep">Link</a>';
  const state = hydrate(root, {
    attrs: { title: 'Before', 'aria-label': 'Before' },
    classes: ['base', { active: true }, ['nested']],
    styles: { color: 'red' }
  });
  const link = root.querySelector('a');
  assert.equal(link.getAttribute('title'), 'Before');
  assert.equal(link.getAttribute('aria-label'), 'Before');
  assert.equal(link.className, 'server-class base active nested');
  assert.equal(link.style.fontWeight, 'bold');
  state.attrs = { title: 'After' };
  state.classes = ['base', { active: false, next: true }];
  state.styles = null;
  await nextTick();
  assert.equal(link.getAttribute('title'), 'After');
  assert.equal(link.hasAttribute('aria-label'), false);
  assert.equal(link.getAttribute('data-static'), 'keep');
  assert.equal(link.className, 'server-class base next');
  assert.equal(link.style.fontWeight, 'bold');
  assert.equal(link.style.color, '');
});

test('evaluates safe arithmetic logical and conditional template expressions', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = [
    '<strong data-tr-text="count + 1"></strong>',
    '<p data-tr-if="count > 0 && visible">Visible count</p>',
    '<a data-tr-attr="title:count > 1 ? \'many\' : \'one\'">Link</a>',
    '<div data-tr-class="count > 0 && visible ? \'active\' : \'muted\'"></div>'
  ].join('');
  const state = hydrate(root, { count: 1, visible: true });
  assert.equal(root.querySelector('strong').textContent, '2');
  assert.equal(root.querySelector('p').textContent, 'Visible count');
  assert.equal(root.querySelector('a').getAttribute('title'), 'one');
  assert.equal(root.querySelector('div').className, 'active');
  state.count = 2;
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, '3');
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('a').getAttribute('title'), 'many');
  assert.equal(root.querySelector('div').className, 'muted');
});

test('hydrates conditional blocks by mounting and unmounting their DOM nodes', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible">Only when visible</p>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  state.visible = true;
  await nextTick();
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  state.visible = false;
  await nextTick();
  assert.equal(root.querySelector('p'), null);
});

test('hydrates server-hidden conditional blocks and reveals them reactively', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = '<p data-tr-if="visible" hidden>Only when visible</p><div data-tr-show="visible" hidden>Shown when visible</div>';
  const state = hydrate(root, { visible: false });
  assert.equal(root.querySelector('p'), null);
  assert.equal(root.querySelector('div').hidden, true);
  state.visible = true;
  await nextTick();
  assert.equal(root.querySelector('p').hidden, false);
  assert.equal(root.querySelector('p').textContent, 'Only when visible');
  assert.equal(root.querySelector('div').hidden, false);
});

test('hydrates keyed each bindings with scoped reactive rows', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label"></li>';
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  let rows = root.querySelectorAll('li');
  const firstA = rows[0];
  const firstB = rows[1];
  assert.deepEqual([...rows].map(row => row.textContent), ['A', 'B']);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  await nextTick();
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
  state.items.pop();
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['B2', 'A']);
});

test('hydrates server-rendered each rows without duplicating them', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = [
    '<li data-tr-each="item in items" data-tr-key="a" data-tr-key-expression="item.id" data-tr-text="item.label">A</li>',
    '<li data-tr-each="item in items" data-tr-key="b" data-tr-key-expression="item.id" data-tr-text="item.label">B</li>'
  ].join('');
  const initialRows = root.querySelectorAll('li');
  const firstA = initialRows[0];
  const firstB = initialRows[1];
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  let rows = root.querySelectorAll('li');
  assert.equal(rows.length, 2);
  assert.equal(rows[0], firstA);
  assert.equal(rows[1], firstB);
  state.items = [{ id: 'b', label: 'B2' }, { id: 'a', label: 'A' }, { id: 'c', label: 'C' }];
  await nextTick();
  rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['B2', 'A', 'C']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
});

test('hydrates tr:each of syntax and preserves keyed rows on updates', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = [
    '<li data-tr-each="item of items" data-tr-key="a" data-tr-key-expression="item.id" data-tr-text="item.label">A</li>',
    '<li data-tr-each="item of items" data-tr-key="b" data-tr-key-expression="item.id" data-tr-text="item.label">B</li>'
  ].join('');
  const initialRows = root.querySelectorAll('li');
  const firstA = initialRows[0];
  const firstB = initialRows[1];
  const state = hydrate(root, { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  state.items = [{ id: 'b', label: 'Beta' }, { id: 'a', label: 'Alpha' }];
  await nextTick();
  const rows = root.querySelectorAll('li');
  assert.deepEqual([...rows].map(row => row.textContent), ['Beta', 'Alpha']);
  assert.equal(rows[0], firstB);
  assert.equal(rows[1], firstA);
});

test('hydrates tr:each numeric ranges and object value-key-index aliases', async () => {
  const document = installDom();
  const root = document.createElement('section');
  root.innerHTML = [
    '<ol><li data-tr-each="n in count" data-tr-text="n"></li></ol>',
    '<dl>',
    '<dt data-tr-each="(value, key, index) in records" data-tr-key-expression="key" data-tr-text="key + \'=\' + value + \':\' + index"></dt>',
    '<dt data-tr-each="(value, key, index) in records" data-tr-key-expression="key" data-tr-text="key + \'=\' + value + \':\' + index"></dt>',
    '</dl>'
  ].join('');
  const state = hydrate(root, { count: 3, records: { first: 'A', second: 'B' } });
  assert.deepEqual([...root.querySelectorAll('ol li')].map(row => row.textContent), ['1', '2', '3']);
  assert.deepEqual([...root.querySelectorAll('dt')].map(row => row.textContent), ['first=A:0', 'second=B:1']);
  state.count = 2;
  state.records = { second: 'B2', third: 'C' };
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('ol li')].map(row => row.textContent), ['1', '2']);
  assert.deepEqual([...root.querySelectorAll('dt')].map(row => row.textContent), ['second=B2:0', 'third=C:1']);
});

test('each row scopes inherit outer reactive state for expressions', async () => {
  const document = installDom();
  const root = document.createElement('ul');
  root.innerHTML = '<li data-tr-each="item in items" data-tr-key="item.id" data-tr-text="item.label + suffix"></li>';
  const state = hydrate(root, { suffix: '!', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A!', 'B!']);
  state.suffix = '?';
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['A?', 'B?']);
  state.items[0].label = 'Alpha';
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(row => row.textContent), ['Alpha?', 'B?']);
});

test('browser bootstrap preserves existing handlers and hydrates encoded server state', async () => {
  const document = installDom();
  document.body.innerHTML = '<main data-tr-component="counter" data-tr-state="{&quot;count&quot;:2}"><p data-tr-text="count">stale</p></main>';
  window.ThymeleafReactive = { handlers: { increment(state) { state.count++; } } };
  globalThis.EventSource = undefined;
  await import(`./dist/browser.js?bootstrap=${Date.now()}`);
  const count = document.querySelector('p');
  assert.equal(count.textContent, '2');
  assert.equal(typeof window.ThymeleafReactive.hydrate, 'function');
});

test('browser SFC handler bridge supplies the reactive component state first', async () => {
  const document = installDom();
  document.body.innerHTML = '';
  globalThis.EventSource = undefined;
  const { bindSfcHandlers } = await import(`./dist/browser.js?handler-bridge=${Date.now()}`);
  const state = { count: 1 };
  const handlers = bindSfcHandlers(state, {
    increment(current, amount = 1) { current.count += amount; }
  });
  handlers.increment(2);
  assert.equal(state.count, 3);
});

test('SFC script setup supports defineProps and defineEmits component macros', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Child = compileSfcComponent(`
    <template><button @click="save">{{ props.label }}</button></template>
    <script setup>
      const props = defineProps(['label']);
      const emit = defineEmits(['save']);
      const save = () => emit('save', props.label);
    </script>
  `);
  const render = compileSfcComponent('<template><section><Child :label="label" @save="record" /><strong>{{ saved }}</strong></section></template>');
  const state = createApp(render, {
    label: 'First', saved: '', components: { Child }, record(value) { this.saved = value; }
  }).mount(root);
  assert.equal(root.querySelector('button').textContent, 'First');
  root.querySelector('button').dispatchEvent(new Event('click'));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'First');
  state.label = 'Second';
  await nextTick();
  assert.equal(root.querySelector('button').textContent, 'Second');
});

test('SFC script setup defineModel follows the component v-model contract', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const Editor = compileSfcComponent(`
    <template><input v-model="model" aria-label="editor" /></template>
    <script setup>const model = defineModel();</script>
  `);
  const render = compileSfcComponent('<template><section><Editor v-model="message" /><strong>{{ message }}</strong></section></template>');
  const state = createApp(render, { message: 'Before', components: { Editor } }).mount(root);
  const input = root.querySelector('input');
  assert.equal(input.value, 'Before');
  input.value = 'After';
  input.dispatchEvent(new Event('input'));
  await nextTick();
  assert.equal(state.message, 'After');
  assert.equal(root.querySelector('strong').textContent, 'After');
});

test('SFC defineModel supports a literal default for named models', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Editor = compileSfcComponent(`
    <template><strong>{{ title }}</strong></template>
    <script setup>const title = defineModel('title', { default: 'Untitled' });</script>
  `);
  createApp(() => h(Editor)).mount(root);
  assert.equal(root.querySelector('strong').textContent, 'Untitled');
});

test('SFC script setup withDefaults applies isolated literal prop defaults', () => {
  const document = installDom();
  const root = document.createElement('main');
  const Badge = compileSfcComponent(`
    <template><strong>{{ props.label }}:{{ props.options.level }}</strong></template>
    <script setup>const props = withDefaults(defineProps(['label', 'options']), { label: 'Fallback', options: { level: 1 } });</script>
  `);
  const render = compileSfcComponent('<template><section><Badge /><Badge label="Actual" :options="customOptions" /></section></template>');
  createApp(render, { customOptions: { level: 2 }, components: { Badge } }).mount(root);
  assert.deepEqual([...root.querySelectorAll('strong')].map(element => element.textContent), ['Fallback:1', 'Actual:2']);
});

test('browser bootstrap keeps Thymeleaf hydration active when an SFC module cannot load', async () => {
  const document = installDom();
  document.body.innerHTML = '<main data-tr-component="counter" data-tr-component-src="components/Missing.vue" data-tr-state="{&quot;count&quot;:2}"><p data-tr-text="count">stale</p></main>';
  globalThis.EventSource = undefined;
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await import(`./dist/browser.js?fallback=${Date.now()}`);
    await Promise.resolve();
    const root = document.querySelector('main');
    assert.equal(root.querySelector('p').textContent, '2');
    assert.equal(root.dataset.trHydrated, 'true');
  } finally {
    console.error = previousError;
  }
});

test('hydrates tr:on handlers with event arguments and modifiers', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<button data-tr-on="click.prevent.stop.once:save">Save</button>';
  let calls = 0;
  let received;
  const state = hydrate(root, {}, {
    save(current, event) {
      calls++;
      received = [current, event.type];
    }
  });
  const button = root.querySelector('button');
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  button.dispatchEvent(event);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.deepEqual(received, [state, 'click']);
  assert.equal(calls, 1);
  assert.equal(event.defaultPrevented, true);
});

test('hydrates tr:on capture handlers before bubbling handlers', () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<div data-tr-on="click.capture:capture"><button data-tr-on="click:bubble">Click</button></div>';
  const calls = [];
  hydrate(root, {}, {
    capture() { calls.push('capture'); },
    bubble() { calls.push('bubble'); }
  });
  root.querySelector('button').dispatchEvent(new Event('click', { bubbles: true }));
  assert.deepEqual(calls, ['capture', 'bubble']);
});

test('hydrates tr:html content reactively', async () => {
  const document = installDom();
  const root = document.createElement('main');
  root.innerHTML = '<section data-tr-html="content">stale</section>';
  const state = hydrate(root, { content: '<strong>Ready</strong>' });
  const section = root.querySelector('section');
  assert.equal(section.innerHTML, '<strong>Ready</strong>');
  state.content = '<em>Updated</em>';
  await nextTick();
  assert.equal(section.innerHTML, '<em>Updated</em>');
});

test('Suspense renders fallback until an async component resolves', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let resolve;
  const Async = defineAsyncComponent(() => new Promise(done => { resolve = done; }));
  const app = createApp(() => h(Suspense, { fallback: h('p', {}, 'Waiting') }, [h(Async)]));
  app.mount(root);
  assert.equal(root.textContent, 'Waiting');
  resolve(() => h('strong', {}, 'Ready'));
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Ready');
  assert.equal(root.querySelector('p'), null);
  app.unmount();
});

test('SFC script setup methods receive event and explicit arguments', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const component = compileSfcComponent(`
    <template>
      <section><button @click="save($event)">Save</button><strong>{{ value }}</strong></section>
    </template>
    <script setup>
      const value = ref('none');
      const save = (event) => value.value = event.detail;
    </script>
  `);
  const app = createApp(() => h(component));
  app.mount(root);
  root.querySelector('button').dispatchEvent(new CustomEvent('click', { detail: 'saved', bubbles: true }));
  await nextTick();
  assert.equal(root.querySelector('strong').textContent, 'saved');
  app.unmount();
});

test('nested Suspense boundaries isolate their pending async descendants', async () => {
  const document = installDom();
  const root = document.createElement('main');
  let resolve;
  const Async = defineAsyncComponent(() => new Promise(done => { resolve = done; }));
  const app = createApp(() => h(Suspense, { fallback: h('p', {}, 'Outer loading') }, [
    h('section', {}, [
      h('h1', {}, 'Outer content'),
      h(Suspense, { fallback: h('p', {}, 'Inner loading') }, [h(Async)])
    ])
  ]));
  app.mount(root);
  assert.equal(root.querySelector('h1').textContent, 'Outer content');
  assert.equal(root.textContent, 'Outer contentInner loading');
  assert.equal(root.textContent.includes('Outer loading'), false);

  resolve(() => h('strong', {}, 'Inner ready'));
  await Promise.resolve();
  await nextTick();
  assert.equal(root.textContent, 'Outer contentInner ready');
  app.unmount();
});

test('Transition runs enter and leave lifecycle hooks around keyed replacement', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = reactive({ showFirst: true });
  const events = [];
  const app = createApp(() => h(Transition, {
    name: 'fade',
    onBeforeEnter: () => events.push('before-enter'),
    onAfterEnter: () => events.push('after-enter'),
    onBeforeLeave: () => events.push('before-leave'),
    onAfterLeave: () => events.push('after-leave')
  }, [h('p', { key: state.showFirst ? 'first' : 'second' }, state.showFirst ? 'First' : 'Second')]));
  app.mount(root);
  assert.equal(root.textContent, 'First');
  assert.deepEqual(events, ['before-enter']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(events, ['before-enter', 'after-enter']);
  state.showFirst = false;
  await nextTick();
  assert.equal(root.textContent, 'SecondFirst');
  assert.deepEqual(events.slice(-1), ['before-leave']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(root.textContent, 'Second');
  assert.deepEqual(events.slice(-2), ['after-enter', 'after-leave']);
  app.unmount();
});

test('TransitionGroup preserves keyed nodes and transitions list additions and removals', async () => {
  const document = installDom();
  const root = document.createElement('main');
  const state = reactive({ items: ['a', 'b'] });
  const events = [];
  const app = createApp(() => h(TransitionGroup, {
    tag: 'ul',
    name: 'list',
    onAfterEnter: element => events.push(`enter:${element.textContent}`),
    onAfterLeave: element => events.push(`leave:${element.textContent}`)
  }, state.items.map(item => h('li', { key: item }, item))));
  app.mount(root);
  const first = root.querySelector('li');
  state.items = ['b', 'c'];
  await nextTick();
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['b', 'c', 'a']);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(events.includes('enter:c'));
  assert.ok(events.includes('leave:a'));
  assert.equal(first.parentNode, null);
  assert.deepEqual([...root.querySelectorAll('li')].map(item => item.textContent), ['b', 'c']);
  assert.equal(root.querySelectorAll('li')[0].textContent, 'b');
  app.unmount();
});
