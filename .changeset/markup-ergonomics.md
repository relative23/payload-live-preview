---
'payload-live-preview': minor
---

Conditional and derived markup (roadmap 1.3.0). `data-payload-depends="price currency"`
on a binding declares the fields whose change re-applies it under `skipUnchanged`;
it is parsed by the same module the `dependencies` option uses and merged into
one map. `data-payload-strategy` names the delivery strategy — `patch`,
`fragment` or `route`; an unknown name is left unchanged with `LP0407`. `data-payload-boundary` marks a stable anchor for a field that
may be empty: hidden while empty, shown when filled; `PreviewBoundary.astro`
(`payload-live-preview/astro/PreviewBoundary.astro`) renders it.
`data-payload-island` and `data-payload-owned` mark subtrees the morph never
enters. The Astro `renderLivePreviewScript()` now maps options through the
shared policy, so `skipUnchanged`, `scopeBindingsByOwner` and `defaults` reach
it too.
