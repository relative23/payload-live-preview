---
'payload-live-preview': major
---

Two defaults change (ADR 0007, rows 22 and 33).

- The Astro integration without `mode` delivers through `'loader'`: every page carries a bootstrap of a few hundred bytes, and the runtime is a content-hashed, SRI-verified asset at `/_payload-live-preview/runtime.<hash>.js` that only a preview fetches. `mode: 'inline'` keeps the 2.x delivery, the whole runtime in every page. Under a Content-Security-Policy the bootstrap's hash differs from the inline runtime's, and `script-src` has to allow the same-origin asset.
- `new OriginDetector()` trusts the origin of `document.referrer` only with `enableReferrerDetection: true`. The runtime, `LivePreviewClient` and the hooks already passed the option, so this reaches only a detector you build yourself.
- The two development notices that announced these defaults are gone.
