---
'payload-live-preview': major
---

2.0 — secure and explicit by default. The v2 readiness table is now the
default: production response changes require an authorized preview context
(`strict`), the intent signal is query-only (iframe and referer are opt-in),
`allowedOrigins` are required, referrer trust is off, messages must come from
the parent or opener, unchanged bindings are skipped, and the sanitizer runs
in strict mode. `serverURL` now requires an explicit `mergeDepth` (choose `0`
for none). Pass `defaults: 'v1'` to opt back into the 1.x behaviour one row at
a time while migrating.

Removed the deprecated 1.x APIs (ADR 0007): `isPreviewRequest()` (use
`hasPreviewIntent()`), the root `fetchPreviewDocument()` / `fetchPreviewGlobal()`
helpers (use `definePreview()` from `payload-live-preview/server`), and the
`createPreviewBindings({ authorized: boolean })` form (use
`{ authorization }` from `authorizePreviewRequest()`).

Run `pll migrate` to rewrite the renamed and moved APIs, and `pll doctor --v2`
to audit a served page against the new defaults. See docs/migration.md.
