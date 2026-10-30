---
'payload-live-preview': patch
---

The CSP merge under `manageCsp: 'full'` keeps what a page's policy allowed for scripts when that policy has no `script-src`. A browser then takes scripts from `default-src`, but the merge set `script-src` to the runtime's own sources alone: a policy of `default-src https://cdn.example.com` became `script-src 'self' 'nonce-…'`, which blocked the CDN and allowed the page's own origin. A fetch directive the merge adds now starts from the value it falls back to (`script-src-elem` and `style-src-elem` from `script-src` and `style-src`, `frame-src` from `child-src`, `worker-src` from `child-src` and then `script-src`, each finally from `default-src`) and adds to it. A policy that already has the directive, or has no `default-src`, merges as before.
