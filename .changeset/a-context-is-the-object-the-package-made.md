---
'payload-live-preview': major
---

An authorized preview context is the object `authorizePreviewRequest()` made, and nothing else passes for one (ADR 0007, row 44). Its mark was a registry symbol, because every entry carried its own copy of the module: a frozen copy of a context kept the symbol and passed, and so did an object built by hand with it. With one module graph the module keeps the contexts it made.

- `isAuthorizedPreviewContext()` refuses a copy, frozen or not, a JSON round trip and a hand-built object.
- `AUTHORIZED_PREVIEW_BRAND_KEY` is gone from the root, `/core` and `/server`. The context has no key of that name.
- Two copies of the package in one process do not accept each other's contexts: install one version, and bundle the package the same way wherever a context travels.
