---
'payload-live-preview': major
---

The names 2.x kept as deprecated aliases are removed (ADR 0007, rows 1, 13, 16, 19, 20, 24 and 32). `pll migrate` rewrites the ones a codemod can reach, and `pll doctor --v3` lists the places.

- `isPreviewRequest()` is gone from the root and from `payload-live-preview/astro`: call `hasPreviewIntent()`, which takes the same arguments.
- `hasPreviewIntent(request, { adminOrigins })` no longer reads `adminOrigins`: name the option `allowedOrigins`.
- `setSanitizerDocument()` is gone, and the process-wide document with it: a server call names its document, `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })`, `<RichText document={…} />`.
- `onUnboundChange` is gone from the adapters, the generator and the runtime: name it `onUnfaithfulPatch`, where `'route'` is `'escalate'`. An adapter or the generator that is still given it refuses to start.
- A `signed-token` replay store needs `consume(id, expiresAt)`. The `isUsed`/`markUsed` shape and the type `PreviewTokenReplayChecks` are gone, and a store without `consume` is a `PreviewConfigurationError` at the first request.
- `LivePreviewAstroOptions` has no `authorizePreview` and no `shouldInject`; the integration refused both at startup since 2.1. `createLivePreviewMiddleware()` takes `PreviewAdapterOptions`, which has them.
- `livePreviewScriptProps()` builds the bootstrap of `delivery: 'asset'` only and throws without it. For an inline script a layout awaits `LivePreviewScript({ request, ...options })`, which renders nothing for a request it does not authorize.
