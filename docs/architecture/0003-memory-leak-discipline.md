# ADR 0003 — Memory-leak discipline

**Status:** Accepted • **Date:** 2026-05-16

## Context

A long-running live-preview session may emit thousands of updates over its lifetime. The previous module-singleton model in `0.1.0` already burned us once (see ADR 0002); the per-instance model fixes the cross-instance pollution, but it does _not_ automatically prevent the slow, single-instance leaks that show up after an editor has been writing for an hour.

This ADR documents the rules every state-bearing primitive in the library must follow so the runtime can stay flat in memory across long sessions.

## Decision

### 1. WeakMap / WeakSet for persistent DOM-keyed metadata

Persistent passive metadata keyed by an `Element` or `Document` lives in a `WeakMap`
or `WeakSet`. The DOM key becoming unreachable (because the host re-rendered its DOM
or discarded a document) must let the entry collect.

Enumerable, active-work state is the narrow exception. Scheduler pending/replay/flush
snapshots and the observer's current visibility set use strong collections while the
owning runtime is active because they must be iterated or synchronously reconciled.
Those collections are bounded by live work, remove entries when bindings disappear or
are superseded, and are synchronously cleared by `stop()`/`destroy()`. Strong DOM keys
must never be used as an unbounded passive metadata cache.

Affected modules:

- `@core/cache` — `ElementCache` walks the live tree; any per-element annotation goes through WeakMap.
- `@core/a11y` — a runtime-root-document-keyed lease coordinates the shared live region, reference count, ownership flag, package-owned announcement node, and one bounded clear timer without detaching consumer children.
- `@core/structural-applier` — `previousItemValues: WeakMap<Element, Map<string, unknown>>` keeps a per-container snapshot for recursive nested-array diffs.
- `@field-types/structural-array` — per-renderer `WeakMap<Element, …>` state keeps
  values, template metadata, and the last direct-child key snapshot together;
  `warnedContainers: WeakSet<Element>` follows the same rule.
- `@field-types/text` — its one-time structured-child warning set is created with
  each renderer/client snapshot rather than shared at module scope.
- `@plugins/manager` — plugin contexts are owned per-runtime, dropped on `destroy()`.

### 2. Every observer / timer pairs with an explicit teardown

Anything that subscribes to a global (window event, IntersectionObserver, MutationObserver, setTimeout, setInterval) must:

1. Live inside a class that owns a `destroy()` / `detach()` / `stop()` method.
2. Have a matching unit test that calls the teardown and asserts the underlying handle has been released.
3. Be idempotent — `destroy()` called twice must not throw, and must not double-detach.

Reference: `tests/unit/core/observers-lifecycle.test.ts`, `tests/unit/core/state.test.ts` and the `message-bus-*.test.ts` suites exercise these patterns.

### 3. Bounded caches

Module-scoped lookup caches use an LRU bound, never an unbounded `Map`. Today this rule applies to:

- `@core/intl-cache` — bounded to 64 entries by default, adjustable via `setIntlCacheLimit`. The cache stores pure values (`Intl.NumberFormat`, `Intl.DateTimeFormat`) keyed by `(locale, options)` so module-scoped sharing is safe.
- `@core/template-sanitize` — the per-template sanitizer options are memoised in a map bounded to `TEMPLATE_CACHE_LIMIT` (64). A nested template is interpolated with its parent's, so an outer value that lands in it mints a key per item and per keystroke; without the bound the page would keep every one.
- `@core/lru` — the `lruGet`/`lruSet`/`lruTrim` helpers both caches share. Functions over the caller's `Map` rather than a class: the minifier shortens function names but not property names, so the class form measured larger in the inline bundle.

When adding a new cache, copy that pattern — including a test that asserts the LRU eviction policy.

### 4. Listeners on `EventEmitter` are owned, not orphaned

`EventEmitter.on()` returns an unsubscribe handle. Long-lived owners (plugins, the runtime itself) must store every handle they create and call it during their teardown. Anonymous listeners that the owner cannot revoke are forbidden in this codebase.

The plugin manager enforces this for `LivePreviewPlugin` instances: every listener registered through `ctx.events.on` is collected and revoked on plugin unregister.

### 5. The inline runtime owns no strongly retained module-level lifecycle or DOM state

The inline IIFE that ships in `runtime.generated.ts` instantiates one
`LivePreviewRuntime` and stores its API on the per-page global
`window.__livePreview`. Duplicate script injection reuses that live API instead of
constructing a second runtime. Explicitly calling the global API's `destroy()` tears
down the runtime and clears the handle, so a later bootstrap can construct a fresh
instance. The highlight plugin and accessibility announcer use the narrow module-scope
`WeakMap` lease exceptions documented in ADR 0002: their weak DOM keys coordinate
multi-client ownership without retaining discarded documents or elements. The
announcer's final lease release also cancels its shared timer.
Realm-wide renderer configuration and the bounded pure-value Intl cache are the
non-DOM exceptions described in ADR 0002 and section 3; neither owns a client lifecycle
or retains a document/element.

## Consequences

|                                                   |                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| ✅ Long sessions stay flat                        | Editor + autosave loops for hours don't drift in heap                          |
| ✅ DOM-tree rebuilds release state automatically  | View-Transitions, fragment swaps                                               |
| ✅ Test discipline catches regressions at PR time | Each new observer comes with a teardown test                                   |
| ⚠️ Slightly more verbose API surface              | Every primitive is a class with `destroy()` — acceptable trade for correctness |

## How to verify

- `npm run test` — every primitive's teardown is asserted.
- `npm run test:leak` — runs under `node --expose-gc`, drives 10,000 fully
  awaited updates through one long-lived runtime plus repeated ownership churn,
  and checks both retained heap and exact observer/listener/timer/DOM-resource
  counts. Retained drift must stay below 2 MiB after forced collection.
- Manual: open Chrome DevTools → Memory → record heap snapshot before and after a 5-minute editor session against a Payload admin instance. Diff should be < 1 MB.

## When in doubt

Default to a class with a teardown method, a `WeakMap` for persistent DOM-keyed metadata,
and a unit test that destroys-and-recreates the primitive in a tight loop. Use a strong
DOM-keyed collection only for bounded, enumerable in-flight state with synchronous
removal and teardown. Reach for module-scoped state only when the value is pure (no
listeners, no DOM references) and even then put a bound on it.
