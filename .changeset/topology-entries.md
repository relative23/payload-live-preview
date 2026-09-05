---
'payload-live-preview': minor
---

Four focused package entries join `payload-live-preview/core` and
`payload-live-preview/server`: `payload-live-preview/client` (the
`LivePreviewClient` and `initLivePreview()`), `payload-live-preview/structural`
(the structural array renderer, the keyed morph and the dependency helpers),
`payload-live-preview/lexical` (the Lexical renderer and its registries) and
`payload-live-preview/plugins` (the plugin manager, plugin types and the
built-in plugins). Each ships ESM and CommonJS with self-contained
declarations and its own API report, and is verified from the packed tarball.
The root barrel is unchanged (ADR 0012, package topology and delivery
profiles).
