---
'payload-live-preview': minor
---

Setup in one line per framework.

`payload-live-preview/nuxt-module` is a Nuxt module: add it to `modules` and write the options under `livePreview` in `nuxt.config.ts`. It generates the Nitro plugin you would otherwise have written into `.nuxt/` and registers it, so the generated file stays readable as the hand-written setup it replaces. Options are serialized into it, which is why `authorizePreview` and `shouldInject` are not part of the module's option type — a preview that needs either still registers `livePreviewNitroPlugin()` by hand.

`withLivePreview(nextConfig, { allowedOrigins })` from `payload-live-preview/nextjs` writes what only `next.config.ts` can give a preview: `private, no-store` on requests carrying preview intent, appended to an existing `headers()` rather than replacing it, plus the admin host in `allowedDevOrigins`. It writes no CSP — a config rule cannot run `authorizePreview` — so `frame-ancestors` for the admin origin comes from `createLivePreviewMiddleware`.

SvelteKit needed nothing: `livePreviewHandle` is already a single export in `hooks.server.ts`.
