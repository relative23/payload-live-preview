# ADR 0002 — Per-instance isolation over module singletons

**Status:** Accepted • **Date:** 2026-05-15

## Context

`0.1.0` used a module-level `livePreviewEvents` emitter and a `PluginManager` that registered to it. Multiple `LivePreviewClient` instances therefore shared listeners; calling `destroy()` on one detached _every_ consumer's handlers — a silent footgun for embedders that wrap our library in their own framework integration.

## Decision

Every stateful primitive is now a class:

- `EventEmitter`, `PluginManager`, `OriginDetector`, `HeartbeatTimer`, `ConnectionState`, `ElementCache`, `ObserverManager`, `UpdateScheduler`, `LivePreviewRuntime`, `LivePreviewClient`.

Runtime, event, plugin, field-renderer-layer, and cache state remains per instance.
The sanitizer policy is per instance as well: `sanitizerPolicy` travels from the client configuration or the inline script through `RuntimeOptions` into every renderer's `RenderContext`, and no runtime writes the module-level default — `setSanitizerPolicy()` remains the process-wide default only for direct `sanitizeHtml()` callers and for a render context without a policy (see `tests/integration/client-sanitizer-policy.test.ts`).
Two deliberate module-scope exceptions coordinate shared DOM effects through DOM-keyed `WeakMap`
leases: the built-in highlight plugin leases its style element and active highlight
class, while the accessibility announcer leases one live region and its clear timer
per runtime-root document. Lease counters prevent one client from removing or
clearing a resource still used by another; ownership flags prevent removal of
consumer-owned DOM. The shared timer clears only the exact package-owned text node,
so a newer consumer announcement is never erased. An adopted element receives a
dedicated appended text node; its consumer-owned child subtree is never detached or
serialized, preserving child identity, listeners, and external node references.
Weak keys do not retain discarded documents or elements, and no renderer, transform,
origin, or update state is shared through these maps.

Public explicit renderer-extension registries are separate, realm-wide configuration:
`registerLexicalNode()` and `registerBlockRenderer()` affect Lexical renders in that
module realm, while `registerBuiltinRenderer()` affects field-renderer snapshots built
after registration. They are not plugin-owned client layers and are not automatically
copied between the server realm and the prebuilt inline runtime. Plugin renderer stacks
and every stateful built-in renderer remain per client.

Stateful built-in renderers are also constructed per client. Structural-array
value/template/DOM snapshots and text-renderer warning deduplication live in each
renderer closure; building a second client creates fresh `WeakMap`/`WeakSet` state.
The runtime's internal no-write marker contains immutable package-function identity
only. Its weak keys do not retain renderer functions and it carries no render data.
The marker deliberately uses a process-local `WeakSet` instead of branding callbacks:
package callbacks may be frozen or supplied through hostile proxies, and registration
must neither mutate them nor fail because a property cannot be defined.

Tests assert isolation explicitly (see `tests/unit/events/emitter.test.ts` → "multi-instance isolation" and `tests/integration/client.test.ts` → "per-instance isolation").

## Consequences

|                                                                                    |                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| ✅ Multiple previews coexist (multi-tenant admin embeds, side-by-side comparisons) |                                                                       |
| ✅ `destroy()` is well-defined                                                     |                                                                       |
| ✅ Tests are deterministic                                                         | No accidental cross-test pollution                                    |
| ✅ Shared DOM effects are leased                                                   | One client cannot tear down another client's highlight or live region |
| ⚠️ Marginally larger memory footprint                                              | Acceptable: one client per page is the typical case                   |
