---
'payload-live-preview': minor
---

Migration tooling for 2.0. `pll migrate <path>` (the codemods live in
`payload-live-preview/migrate`) rewrites the 1.x → 2.0 renames and moves from
the renames ledger (ADR 0007, 2.0 defaults, migration policy, and the renames
ledger): `isPreviewRequest` → `hasPreviewIntent`, the `createPreviewBindings`
`authorized` option → `authorization`, the root `fetchPreview*` helpers →
`definePreview()` on `payload-live-preview/server`. It touches only
identifiers imported from this package and exits `3` when a site needs a
human. `pll doctor --v2 <url>` reads a served page's inline configuration and
reports each readiness row the page runs at its 1.x value — referrer trust,
message source policy, sanitizer policy, `skipUnchanged` — as `LP0709`, each
with the option that closes it. docs/migration.md walks the `defaults: 'v2'`
table row by row with before/after examples.
