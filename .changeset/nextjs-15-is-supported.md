---
'payload-live-preview': minor
---

Next.js 15.5 is supported next to 16. The `next-matrix` job installs `next@^15` into the Next.js fixture on every push and runs the Next.js cases of the default suite, the webpack production suite and the base-path suite in Chromium; the README lists the version it ran, and `npm run compat:check` keeps the list and the workflow's matrix the same. 2.0.x failed on Next.js 15 because the script component and the fragment endpoint loaded `react` through computed imports, which 2.1 replaced by literal ones. Earlier 15 minors are not claimed (ADR 0031).
