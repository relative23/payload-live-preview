---
'payload-live-preview': patch
---

The `strict` default warns once when it accepts an `http:` admin origin only because `NODE_ENV` is not set. It requires https admin origins outside development, and an unset `NODE_ENV` counts as development, so a production server started without it, such as `node build` from SvelteKit's Node adapter, accepted `http:` origins without a word. Nothing else changes: a server with `NODE_ENV=production` still refuses them at startup, and one with `NODE_ENV=development` still accepts them silently.
