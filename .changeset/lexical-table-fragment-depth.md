---
'payload-live-preview': patch
---

Accept ordinary nested Lexical tables in fragment requests by raising the fixed field-depth ceiling from 12 to 64. The reported table inside a content block reaches depth 15 and was rejected before rendering. Keep the existing generic refusal response and authorization checks; requests beyond 64 levels remain rejected before authorization or rendering.
