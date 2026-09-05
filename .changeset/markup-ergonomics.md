---
'payload-live-preview': minor
---

Conditional and derived markup. `data-payload-depends="price currency"` on a
binding declares the fields whose change re-applies it under `skipUnchanged`;
it is parsed by the same module the `dependencies` option uses and merged into
one map. `data-payload-strategy` names the delivery strategy — `patch`,
`fragment` or `route`; an unknown name is left unchanged with `LP0407`.
`data-payload-boundary` marks an empty-field anchor: a stable element for a
field that may be empty, hidden while empty, shown when filled;
`PreviewBoundary.astro` (`payload-live-preview/astro/PreviewBoundary.astro`)
renders it. `data-payload-island` and `data-payload-owned` mark subtrees the
morph never enters. The Astro `renderLivePreviewScript()` maps its options
through the shared adapter policy, so `skipUnchanged`, `scopeBindingsByOwner`
and `defaults` reach the inline runtime too.
