---
'payload-live-preview': minor
---

What 3.0 removes now says so while it still runs. `isPreviewRequest()`, `hasPreviewIntent({ adminOrigins })`, `setSanitizerDocument()`, `onUnboundChange`, the `signed-token` replay store `{ isUsed, markUsed }` and `defaults: 'v1'` each warn once per process in development, never in production, and name what replaces them. `pll migrate` gains two codemods: `rename-on-unbound-change` turns `onUnboundChange: 'route'` into `onUnfaithfulPatch: 'escalate'`, and `expand-defaults-v1` writes the rows `defaults: 'v1'` stands for into the options, with the same values. `isPreviewRequest` is now a function that calls `hasPreviewIntent` rather than the same value. Nothing is removed; "Preparing for 3.0" in docs/migration.md lists each change (ADR 0026).
