---
'payload-live-preview': minor
---

Nuxt fragments: a component that throws while rendering now fails the render in production as it does in development, so the runtime patches the boundary; Vue's production build had answered an empty fragment, which emptied it. `fragmentComponentPlugins(vue, { srcDir })` from `payload-live-preview/nuxt-module` replaces the hand-written Nitro plugin setup: it hashes scope ids from the directory Nuxt's own build uses, so scoped styles reach fragment content on Nuxt 4's `app/` layout, and it keeps component CSS out of the server bundle, where it broke the build. The module exposes `getMeta()`, so `livePreview` type-checks in `nuxt.config.ts`. The Nuxt guide says that Nuxt 3 is past its end of life and no longer supported officially (ADR 0030).
