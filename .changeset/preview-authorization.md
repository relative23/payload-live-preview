---
'payload-live-preview': minor
---

Authorized preview context (ADR 0006, authorized preview context: threat model
and authorization strategies). `authorizePreviewRequest(request, strategy)`
turns a Payload session, a short-lived signed token (`issuePreviewToken`) or a
consumer-supplied verifier into one branded `AuthorizedPreviewContext`; a
refusal is an outcome, never an exception. Every adapter accepts
`authorizePreview`, and a refusal blocks runtime injection, CSP changes and
nonce exposure regardless of `autoInject` and `shouldInject`.

`strict` (default `true`) refuses to start without the hook, without explicit
`https:` `allowedOrigins`, or with referrer trust, rather than gating a
response on preview intent alone. `defaults: 'v1'` restores intent-only
gating, which is announced once per process outside production. The runtime
option `eventSourcePolicy: 'parent-or-opener'` (the default) accepts updates
only from the window that framed or opened the page; `'any'` is the 1.x
behavior.

`hasPreviewIntent()` is the honest name for what the 1.x `isPreviewRequest()`
did — detect intent, not authorize — and replaces it; `isPreviewRequest()` is
removed and `pll migrate` rewrites the call sites.
