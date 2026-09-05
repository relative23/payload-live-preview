---
'payload-live-preview': patch
---

Polish from the 2.0 readiness pass.

- `CachedElement.boundary` is renamed `hidesWhenEmpty`: the flag marks a
  `data-payload-boundary` empty-field anchor that hides itself while its field
  is empty, and the old name read like a fragment boundary. Only a custom
  renderer that inspected the flag is affected; TypeScript reports the old
  name.
- Constructing a client without a document fails at once with a message that
  names the `root` option, instead of a `TypeError` on the first DOM read in
  `start()`.
- A route refresh that outlives its timeout is logged as a timeout
  (`LP0801 route refresh timed out after N ms`), not as the browser's
  `AbortError` text.
- The per-template sanitizer options cache is bounded (64 entries, least
  recently used evicted).
- `defaults: 'v1'` on `LivePreviewClient` fills every 1.x row
  (`sanitizerPolicy: 'compat'`, `skipUnchanged: false`, referrer detection on,
  any event source). Before this fix the client left the config alone and fell
  through to the runtime's own fallbacks, which are the 2.0 values, so a v1
  client without explicit values sanitized strictly. The inline script was not
  affected: the adapters put the v1 rows on the wire.
