---
'payload-live-preview': patch
---

`manageCsp: 'full'` no longer blocks a page's own inline scripts. The merge added the preview nonce to a `script-src` that allowed inline scripts with `'unsafe-inline'` (directly or through `default-src`), and CSP 2 and later ignore `'unsafe-inline'` once a nonce is in the list: Chromium, Firefox and WebKit blocked every inline script of the page on the preview response. Where the page's directive holds `'unsafe-inline'` and no nonce, hash or `'strict-dynamic'`, `mergeCspHeader` now leaves nonces and hashes out of a union, and the injected tag runs under `'unsafe-inline'` like the page's scripts. With `strictDynamic: true` the nonce is still added.
