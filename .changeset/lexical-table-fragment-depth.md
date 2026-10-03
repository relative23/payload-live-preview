---
'payload-live-preview': minor
---

Accept nested Lexical rich-text tables in fragment requests by raising the default field depth limit from 12 to 64. Add `limits.fieldDepth` to fragment endpoints with a supported range of 0 to 64, keeping validation before authorization bounded. Projects can set a stricter limit such as 24 without forking the package.
