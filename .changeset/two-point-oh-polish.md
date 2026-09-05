---
'payload-live-preview': patch
---

Polish that landed with the 2.0 readiness pass.

- `CachedElement.boundary` is now `hidesWhenEmpty`: the flag marks a `data-payload-boundary` anchor that hides itself while its field is empty, and the old name read like a fragment boundary. Only a custom renderer that inspected the flag is affected; TypeScript reports the old name.
- `LivePreviewRuntime` refuses to construct without a document and says so (`pass options.root`), instead of failing with a `TypeError` on the first DOM read in `start()`.
- A route refresh that outlives its timeout is logged as a timeout (`LP0801 route refresh timed out after N ms`), not as the browser's `AbortError` text.
- The per-template sanitizer options cache is bounded (64 entries, least recently used evicted), closing the one unbounded cache ADR 0003 did not cover.
- `defaults: 'v1'` on `LivePreviewClient` now fills the 1.x rows (`sanitizerPolicy: 'compat'`, `skipUnchanged: false`, referrer detection on, any event source). It used to leave the config alone and fall through to the runtime's fallbacks, which have been the 2.0 values since the default flip — so a v1 client without explicit values was sanitising strictly. The inline script was not affected: the adapters already put the v1 rows on the wire.
