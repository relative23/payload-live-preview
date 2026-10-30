---
'payload-live-preview': patch
---

The `payload-session` strategy asks `/me` once, not twice, for a token Payload refuses, once it has seen that the endpoint needs the origin. Each such refusal used to cost a cookie-only request and a retry with the origin: an invalid or expired cookie, and on Payload 3 every signed-in user of another auth collection, on every page that checks the session. After the origin has found a user, the strategy sends it from the first request to that `/me`, keyed by endpoint so the per-request strategies of the framework recipes share it. At most once a minute it tries the cookie alone again and goes back to it when that finds the user, so a CMS rolled back to accept the cookie alone is noticed. A CMS that accepts the cookie alone is not remembered and keeps two requests for a refused token; an explicit `origin` makes it one.
