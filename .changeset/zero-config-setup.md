---
'payload-live-preview': minor
---

Setup in one line per framework.

`payload-live-preview/nuxt-module` is a Nuxt module: add it to `modules` and write the options under `livePreview` in `nuxt.config.ts`. It generates the Nitro plugin you would otherwise have written into `.nuxt/` and registers it, so the generated file stays readable as the hand-written setup it replaces. Options are serialized into it, which is why `authorizePreview` and `shouldInject` are not part of the module's option type — a preview that needs either still registers `livePreviewNitroPlugin()` by hand.

`withLivePreview(nextConfig, { allowedOrigins })` from `payload-live-preview/nextjs` writes the two headers a preview needs and only `next.config.ts` can give it: `frame-ancestors` and `private, no-store` on requests carrying preview intent, appended to an existing `headers()` rather than replacing it, plus the admin host in `allowedDevOrigins`. It is gated on intent alone, so a site with its own CSP or a stricter gate keeps using `createLivePreviewMiddleware`.

SvelteKit needed nothing: `livePreviewHandle` is already a single export in `hooks.server.ts`.
