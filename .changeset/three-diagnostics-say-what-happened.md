---
'payload-live-preview': patch
---

A Next.js cache header now follows the runtime's own reading of preview intent, and two diagnostics stop describing things that did not happen.

- `withLivePreview()` marks `?preview=1`, `?draft=1` and `?livePreview=1` `private, no-store`, as it already did for `=true`. The runtime has always read both `true` and `1` as intent, but Next evaluates a header rule's `value` as an anchored regular expression and the rule named only `true`, so a preview response reached with `=1` could be kept by a shared cache. Measured with `next build` and `next start` on Next.js 16.3.0: `?preview=1` answered `public, max-age=0` before, `private, no-store` after; `?preview=0` and `?preview=x1` stay public.
- LP0104 told a page on the lean runtime to remove `profile: 'lean'`, a field of the `LEAN_RUNTIME` artifact that nobody writes. It names `runtime: LEAN_RUNTIME`, the option that delivered it.
- LP0409 said the 1.x default (`sanitizerPolicy: 'compat'`) kept `name`. It did not — no built-in per-tag list allows it — so the warning sent an upgrader looking for a regression that was not one. `name` is reported only where `additionalAllowedAttributes` lets `compat` keep it.
