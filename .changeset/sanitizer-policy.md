---
'payload-live-preview': minor
---

Sanitizer policy and Trusted Types. `sanitizerPolicy: 'strict'`, the default,
strips `id` and `name` (DOM clobbering), strips `data-payload-*` (rich text
must never add a binding) and passes other `data-*` only when listed in
`allowedDataAttributes`; `'compat'` is the 1.x behavior and comes back with
`defaults: 'v1'`. Every sanitizer case in the property suite runs under both
policies, and mutation-XSS, namespace-transition, malformed-`srcset`,
clobbering and extension-collision vectors are pinned.

Every HTML sink — the sanitizer's own parse and each renderer write — goes
through one Trusted Types policy named `payload-live-preview`
(`TRUSTED_TYPES_POLICY_NAME`) where the API exists; a site enforcing
`require-trusted-types-for 'script'` lists that name or hands in its own
policy with `setTrustedTypesPolicy()`.
