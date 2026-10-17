---
'payload-live-preview': patch
---

The Next.js recipe awaits `LivePreviewScript` in the layout (`const livePreview = await LivePreviewScript({ … })`, rendered in `<head>`) instead of rendering `<LivePreviewScript />`. On Next.js 15.5 the element form lets React begin to hydrate `<head>` before the component's part of the stream has arrived and report error #418, in about one load in ten on a two-core machine; the awaited form did not in 80 measured loads.
