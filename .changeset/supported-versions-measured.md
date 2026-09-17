---
'payload-live-preview': patch
---

The supported versions say what was measured.

Next.js 15 is no longer listed: on Next.js 15.5 the adapter's pages fail with `Cannot find module 'react'`, because it loads React through a runtime import that webpack, Next.js 15's default bundler, cannot resolve. Next.js 16 is supported and tested. Payload 2.x stays supported, now backed by a wire corpus captured from a real Payload 2.32.3 admin and replayed in the test suite, next to the 3.x and 4.0 captures.
