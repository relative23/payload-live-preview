---
'payload-live-preview': patch
---

The Nuxt module names the file an `authorizePreviewModule` points at, with its extension, so the documented `./server/utils/live-preview-auth` loads in `nuxt dev` as it already did in a production build. A `./` reference and one of Nuxt's aliases (`~/`, `~~/`) resolve to `.ts`, `.mts`, `.js`, `.mjs`, `.cts`, `.cjs` or a directory's `index`; one that names no file stays as written.
