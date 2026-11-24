---
'payload-live-preview': minor
---

`pll doctor --v3 <path>` reads a project's source and lists, by row of the 3.0 ledger (ADR 0007), every call of the package that 3.0 changes, with file and line: a hook without `document` or `timeoutMs`, an adapter that merges without `mergeTimeoutMs`, `lexicalToHtml()` without a document, `setSanitizerDocument()`, `defaults: 'v1'`, a detector without `enableReferrerDetection`, `livePreviewScriptProps()` delivering inline, the Astro integration without `mode`, and `strict: false`. It reads options written at the call, in a `const` of the same file or in one a relative import names, and lists the calls it could not read. It changes no file, exits 3 when it lists a place, and needs `ts-morph`, as `pll migrate` does. See "Preparing for 3.0" in `docs/migration.md`.
