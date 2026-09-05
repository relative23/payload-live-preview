---
'payload-live-preview': major
---

2.0 is secure and explicit by default. The hardened readiness table is the
default profile: production response changes require an authorization
(`strict`), the intent signal is the query string alone (the `fetch-dest` and
`referer` signals are opt-in through `previewSignals`), `allowedOrigins` are
required and must be `https:`, referrer trust is off, messages must come from
the window that framed or opened the page, unchanged bindings are skipped, and
the sanitizer runs in strict mode. `serverURL` requires an explicit
`mergeDepth` (`0` for none). `defaults: 'v1'` restores the whole 1.x table on
the adapters, the client and the inline script; every row is also an option,
so a migration can move one row at a time.

Removed, with `pll migrate` rewriting each call site:

- `isPreviewRequest()` — use `hasPreviewIntent()`.
- the root `fetchPreviewDocument()` / `fetchPreviewGlobal()` helpers — use
  `definePreview()` from `payload-live-preview/server`.
- `createPreviewBindings({ authorized: boolean })` — pass `{ authorization }`
  from `authorizePreviewRequest()`.

The Astro integration's `mode: 'middleware'` refuses to build under `strict`:
it serializes its options into the build, so it cannot carry the
`authorizePreview` function strict mode requires. Without the check this
combination builds cleanly and then answers every preview request with a 500.
Register `createLivePreviewMiddleware({ authorizePreview })` in your own Astro
middleware instead, or pass `defaults: 'v1'` / `strict: false` for intent-only
middleware.

Migration: run `pll migrate <path>` to rewrite the renamed and moved APIs, and
`pll doctor --v2 <url>` to audit a served page against the new defaults.
docs/migration.md walks the table row by row with before/after examples.
