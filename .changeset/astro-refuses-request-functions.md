---
'payload-live-preview': patch
---

`livePreview()` in `mode: 'inline'` (the default) or `'loader'` refuses `authorizePreview` and `shouldInject` at startup. Both are functions that decide per request, which those modes never do, so a project that passed one had a configuration that read as access control or page selection and ran nothing. The middleware mode already refused them, and `authorizePreviewModule` already was refused in these two modes. The message names where each can run: `authorizePreviewModule` in `mode: 'middleware'`, or `createLivePreviewMiddleware()` in `src/middleware.ts`. The options that only describe a request (`strict`, `previewSignals`, `previewQueryParams`, `inject`, the CSP options) are still accepted, so an options object shared between modes keeps working.
