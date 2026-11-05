---
'payload-live-preview': patch
---

The `payload-session` strategy no longer follows a redirect from `/me`. Fetch followed it by default: on a hop to another origin it dropped the cookie but read the answer there, and a user in that answer was authorized as the editor. The check now asks for `redirect: 'manual'` and refuses a 3xx answer as `unavailable`, a redirect within the same origin included, as the draft reads already do; `serverURL` has to be the origin Payload answers on. `'manual'` rather than `'error'`, because Cloudflare's workerd rejects `'error'`. A custom `fetch` receives `redirect: 'manual'` in its init.
