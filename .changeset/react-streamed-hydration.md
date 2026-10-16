---
'payload-live-preview': patch
---

Wait for React's streamed server boundaries before applying the first live-preview document. Next App Router pages no longer lose that document when an early root commit precedes Suspense hydration.
