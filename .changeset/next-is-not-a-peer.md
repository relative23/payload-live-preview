---
'payload-live-preview': patch
---

`next` is no longer a peer of the package. 2.4.0 declared it as an optional peer for `payload-live-preview/nextjs/client`, and pnpm links an optional peer into every project of a workspace once one project there installs it: a project without Next.js got a copy of `next`, and `pnpm deploy --prod` of one with React and this package came to 339 MB instead of 23 MB. Next.js resolves the entry's `next/navigation` import to the app's own installation, with Turbopack and with webpack, so nothing else changes. A Next.js canary still installs beside the package.
