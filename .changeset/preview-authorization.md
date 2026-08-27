---
'payload-live-preview': minor
---

Authorized preview context (ADR 0006). `authorizePreviewRequest(request, strategy)`
turns a Payload session, a short-lived signed token (`issuePreviewToken`) or a
consumer-supplied verifier into one branded `AuthorizedPreviewContext`; refusals
are outcomes, never exceptions. Every adapter accepts `authorizePreview`, and a
refusal blocks runtime injection, CSP changes and nonce exposure regardless of
`autoInject` and `shouldInject`. Without the hook the 1.0 behaviour — intent
only — remains through 1.x and is announced once per process outside
production. `strict: true` refuses to run without the hook, without explicit
https admin origins, or with referrer trust; `defaults: 'v2'` applies every
2.0 default that exists as an option (ADR 0007). New runtime option
`eventSourcePolicy: 'parent-or-opener'` accepts updates only from the window
that framed or opened the page. `hasPreviewIntent()` is the honest name for
`isPreviewRequest()`, which stays as a deprecated alias. The inline runtime grows by
about 120 B gzipped for the source policy; each adapter bundle by about 1.2 KB
gzipped for the gate, strict checks and profile — budgets raised by the
measured amounts.
