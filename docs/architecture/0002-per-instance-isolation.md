# ADR 0002 — Per-instance isolation over module singletons

**Status:** Accepted • **Date:** 2026-05-15

## Context

`0.1.0` used a module-level `livePreviewEvents` emitter and a `PluginManager` that registered to it. Multiple `LivePreviewClient` instances therefore shared listeners; calling `destroy()` on one detached *every* consumer's handlers — a silent footgun for embedders that wrap our library in their own framework integration.

## Decision

Every stateful primitive is now a class:

- `EventEmitter`, `PluginManager`, `OriginDetector`, `HeartbeatTimer`, `ConnectionState`, `ElementCache`, `ObserverManager`, `UpdateScheduler`, `LivePreviewRuntime`, `LivePreviewClient`.

No module-scope state remains.

Tests assert isolation explicitly (see `tests/unit/events/emitter.test.ts` → "multi-instance isolation" and `tests/integration/client.test.ts` → "per-instance isolation").

## Consequences

| | |
|---|---|
| ✅ Multiple previews coexist (multi-tenant admin embeds, side-by-side comparisons) | |
| ✅ `destroy()` is well-defined | |
| ✅ Tests are deterministic | No accidental cross-test pollution |
| ⚠️ Marginally larger memory footprint | Acceptable: one client per page is the typical case |
