---
'payload-live-preview': patch
---

The `signed-token` strategy refuses a correctly signed token that claims to live longer than an hour, as `'invalid'`. `issuePreviewToken` caps `ttlMs` at one hour, but verification checked only that the token had not expired, so a token minted elsewhere with the same secret could be valid for a year. Every token this package issues, in any 2.x release, stays within the hour and verifies as before.
