---
'payload-live-preview': patch
---

`manageCsp: 'full'` now reaches a page's own `script-src-elem`. The merge added the preview nonce to `script-src` only, and a browser asks `script-src-elem`, where a policy sets it, for every script element: on a page with `script-src-elem 'self'` Chromium, Firefox and WebKit blocked the injected script and the preview never started. A union into `script-src` through `mergeCspHeader` now also reaches an existing `script-src-elem`, by the same `'unsafe-inline'` rule as `script-src`; a `replace` stays with the directive it names.
