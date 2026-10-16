---
'payload-live-preview': minor
---

Add `limits.fieldDepth` to fragment endpoints with an integer range of 0 to 64. The default and hard ceiling remain 64; projects can require a stricter cap such as 24. Requests beyond that cap receive a distinct 400 response with the configured limit before authorization. Keep the contributor's nested Lexical table fixture as a regression for the existing default.
