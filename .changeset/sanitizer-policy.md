---
'payload-live-preview': minor
---

Sanitizer policy and Trusted Types (roadmap 1.3.0, ADR 0007 entry 11).
`sanitizerPolicy: 'strict'` — the 2.0 default, set today by `defaults: 'v2'` —
strips `id` and `name` (DOM clobbering), strips `data-payload-*` (rich text
must never add a binding) and passes other `data-*` only when listed in
`allowedDataAttributes`; `'compat'` stays the 1.x behaviour. Every sanitizer
case in the property suite runs under both policies, and mutation-XSS,
namespace-transition, malformed-`srcset`, clobbering and extension-collision
vectors are pinned. Every HTML sink — the sanitizer's own parse and each
renderer write — now goes through one Trusted Types policy named
`payload-live-preview` where the API exists; a site enforcing
`require-trusted-types-for 'script'` lists that name or hands in its own
policy with `setTrustedTypesPolicy()`.
