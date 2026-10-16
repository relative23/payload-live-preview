---
'payload-live-preview': patch
---

`pll doctor` reports `X-Frame-Options` as `LP0703` only for a response that declares no `frame-ancestors`. A browser skips the header when the response carries the directive, so `DENY` beside a `frame-ancestors` that admits the admin frames fine (measured in Chromium 151, Firefox 153 and WebKit 26.5), and the audit called it an error. The directive's own verdict stays `LP0702`; the `LP0705` remedy now says where `visibilityGateThreshold` can be set, since the adapters do not forward it.
