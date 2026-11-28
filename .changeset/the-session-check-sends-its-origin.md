---
'payload-live-preview': major
---

The `payload-session` strategy sends an `Origin` with the cookie from the first request: `origin` where the strategy names one, the origin of `serverURL` otherwise (ADR 0007, row 49). 2.x asked `/me` with the cookie alone first, added the origin in one retry and remembered per endpoint that it was needed. Only Payload 3.79.0 and older take a server's cookie alone when a `csrf` list is set, and those releases are no longer supported (row 48), so the check is one request now and nothing is remembered between requests. `context.payloadHeaders` always holds the cookie and the origin. Where Payload's `csrf` list does not hold the origin of the `serverURL` given to the strategy, for example when the site reaches Payload on an internal address, set `origin` to an origin the list holds.
