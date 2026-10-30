---
'payload-live-preview': patch
---

An adapter refuses at startup an entry of `allowedOrigins`, `frameAncestorsExtra` or `scriptSrcExtra` that holds `;`, `,` or a control character, and so does `buildLivePreviewCsp()` from `payload-live-preview/nuxt` when it builds. The entries went into the CSP header as written, so `'https://embed.example.com; script-src *'` ended `frame-ancestors` and added a `script-src` of its own. The values come from configuration, not from a request; an entry with several space-separated sources still works.
