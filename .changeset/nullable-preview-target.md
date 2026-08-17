---
'payload-live-preview': minor
---

`buildLivePreviewUrl` can now decline a document instead of always producing a URL.

The callback returned `string`, so "this document has no preview target" was unexpressible. A draft without a slug, a collection that is never rendered, a document with no id — each of them fell through to the fallback path and pointed the preview iframe at an unrelated public page. Payload's own `url` callback accepts `null` for precisely this case and then shows no iframe. Consumers were writing guards around the helper to recover that.

A resolver may now return `null`, and `fallback` accepts `null` to decline every unmapped document. Both forms stay distinguishable at the type level: with string-only resolvers and a string fallback the callback keeps its 1.0 signature and always produces a URL, while using `null` anywhere widens the return type to `string | null`. Existing configurations are unaffected in behaviour and in type.

An empty string keeps its 1.x meaning and falls back, and a slug mapped explicitly to `null` is now treated as a resolver in its own right rather than as an absent entry.
