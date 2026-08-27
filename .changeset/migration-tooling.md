---
'payload-live-preview': minor
---

Migration tooling for 2.0. `pll migrate <path>` (codemods in
`payload-live-preview/migrate`) rewrites the 1.x → 2.0 renames and moves from
ADR 0007 — `isPreviewRequest` → `hasPreviewIntent`, the `createPreviewBindings`
`authorized` option → `authorization`, the root `fetchPreview*` helpers →
`definePreview()` on `payload-live-preview/server` — touching only imports from
this package. `pll doctor --v2` reads a served page's inline configuration and
reports each runtime readiness row still at its 1.x value (referrer trust,
message source policy, sanitizer mode, skipUnchanged) as `LP0709`. The
migration guide gains a row-by-row `defaults: 'v2'` section with before/after,
and a dual-mode test runs the skipUnchanged flip under both profiles.
