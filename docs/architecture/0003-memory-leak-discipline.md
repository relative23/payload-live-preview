# ADR 0003 — Memory-leak discipline

**Status:** Accepted • **Date:** 2026-05-16

## Context

A long-running live-preview session may emit thousands of updates over its lifetime. The previous module-singleton model in `0.1.0` already burned us once (see ADR 0002); the per-instance model fixes the cross-instance pollution, but it does *not* automatically prevent the slow, single-instance leaks that show up after an editor has been writing for an hour.

This ADR documents the rules every state-bearing primitive in the library must follow so the runtime can stay flat in memory across long sessions.

## Decision

### 1. WeakMap / WeakSet for DOM-keyed state

Any state keyed by an `Element` lives in a `WeakMap` or `WeakSet`, never a plain `Map`/`Set`/array. The element becoming unreachable (because the host re-rendered its DOM) must let the entry collect.

Affected modules:

- `@core/cache` — `ElementCache` walks the live tree; any per-element annotation goes through WeakMap.
- `@core/structural-applier` — `previousItemValues: WeakMap<Element, Map<string, unknown>>` keeps a per-container snapshot for recursive nested-array diffs.
- `@field-types/structural-array` — `previousValues: WeakMap<Element, …>` and `warnedContainers: WeakSet<Element>` follow the same rule.
- `@plugins/manager` — plugin contexts are owned per-runtime, dropped on `destroy()`.

### 2. Every observer / timer pairs with an explicit teardown

Anything that subscribes to a global (window event, IntersectionObserver, MutationObserver, setTimeout, setInterval) must:

1. Live inside a class that owns a `destroy()` / `detach()` / `stop()` method.
2. Have a matching unit test that calls the teardown and asserts the underlying handle has been released.
3. Be idempotent — `destroy()` called twice must not throw, and must not double-detach.

Reference: `tests/unit/core/observers.test.ts`, `tests/unit/core/state.test.ts`, `tests/unit/core/message-bus.test.ts` exercise these patterns.

### 3. Bounded caches

Module-scoped lookup caches use an LRU bound, never an unbounded `Map`. Today this rule applies to:

- `@core/intl-cache` — bounded to 64 entries by default, adjustable via `setIntlCacheLimit`. The cache stores pure values (`Intl.NumberFormat`, `Intl.DateTimeFormat`) keyed by `(locale, options)` so module-scoped sharing is safe.

When adding a new cache, copy that pattern — including a test that asserts the LRU eviction policy.

### 4. Listeners on `EventEmitter` are owned, not orphaned

`EventEmitter.on()` returns an unsubscribe handle. Long-lived owners (plugins, the runtime itself) must store every handle they create and call it during their teardown. Anonymous listeners that the owner cannot revoke are forbidden in this codebase.

The plugin manager enforces this for `LivePreviewPlugin` instances: every listener registered through `ctx.events.on` is collected and revoked on plugin unregister.

### 5. The inline runtime owns no module-level state

The inline IIFE that ships in `runtime.generated.ts` instantiates a single `LivePreviewRuntime` and stores it on a per-page global (`window.__livePreview`). Re-entry (HMR, SPA navigation, View-Transitions) must call `destroy()` on the previous instance before constructing a new one. The bootstrap does this; consumers should not need to.

## Consequences

| | |
|---|---|
| ✅ Long sessions stay flat | Editor + autosave loops for hours don't drift in heap |
| ✅ DOM-tree rebuilds release state automatically | View-Transitions, fragment swaps |
| ✅ Test discipline catches regressions at PR time | Each new observer comes with a teardown test |
| ⚠️ Slightly more verbose API surface | Every primitive is a class with `destroy()` — acceptable trade for correctness |

## How to verify

- `npm run test` — every primitive's teardown is asserted.
- `npm run test:bench tests/benchmarks/leak.bench.ts` (when added) — drives N=10k update cycles and measures `process.memoryUsage().heapUsed` deltas. Threshold target: <2 MB drift across 10k cycles.
- Manual: open Chrome DevTools → Memory → record heap snapshot before and after a 5-minute editor session against a Payload admin instance. Diff should be < 1 MB.

## When in doubt

Default to a class with a teardown method, a `WeakMap` for DOM-keyed state, and a unit test that destroys-and-recreates the primitive in a tight loop. Reach for module-scoped state only when the value is pure (no listeners, no DOM references) and even then put a bound on it.
