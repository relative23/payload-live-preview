---
'payload-live-preview': major
---

No response changes on preview intent alone any more (ADR 0007, rows 21 and 36). `strict: false` and `defaults: 'v1'`, the two ways 2.x left open for a staged migration, are removed.

- An adapter that decides per request (`createLivePreviewMiddleware()`, `livePreviewHandle()`, `defineLivePreviewServerHandler()`, `livePreviewNitroPlugin()`, `LivePreviewScript`) needs `authorizePreview`, a non-empty `allowedOrigins` (`https:` in production) and no `'referer'` among the `previewSignals`. Without them it refuses to start, in development too.
- `strict: false` is refused at startup by the adapters and by the Astro integration in every mode. `strict: true` is still taken.
- `defaults: 'v1'` is refused at startup by the adapters, `generateInlineScript()`, `generateLoaderScript()` and `LivePreviewClient`. `defaults: 'v2'` is still taken. `npx pll migrate ./src --only expand-defaults-v1 --write` writes the rows the profile stood for into the options: the four runtime rows and the preview signals without `'referer'`. It does not write `strict: false`; a site that ran on the profile adds a hook (`docs/authorization.md`).
- `serverURL` needs an explicit `mergeDepth` everywhere; the profile's exemption went with it.
- Astro's `mode: 'middleware'` refuses to start without `authorizePreviewModule`.
- Types: `DefaultsProfile` is `'v2'`, `strict` is `true`.
