---
'payload-live-preview': patch
---

The Trusted Types policy `payload-live-preview` is held once per page and shared by every package entry. A second bundle on the page, `payload-live-preview/lexical` beside the runtime, asked the browser for a policy of the same name, was refused under a `trusted-types` directive without `allow-duplicates`, and fell back to writing strings; `setTrustedTypesPolicy()` reached only the entry it was called through. Both now see the one policy.
