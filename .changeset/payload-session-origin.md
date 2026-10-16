---
'payload-live-preview': minor
---

The `payload-session` strategy retries a cookie-only `/me` response with `user: null` once with the origin of `serverURL`, within the existing timeout. This lets Payload 3.89 verify the session when its CSRF list is configured while preserving working Payload 2 sessions. The new `origin` option sends an explicit listed origin from the first request. Draft reads retain the accepted headers through `payloadHeaders`.
