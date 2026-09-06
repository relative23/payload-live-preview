---
'payload-live-preview': minor
---

`delivery: 'asset'`: the runtime as a cached file instead of part of the page.

A preview page carries about 30 KB gzip of runtime today. With `delivery: 'asset'` it carries a bootstrap instead — 679 bytes, measured on the Next.js example — which checks for a preview context and only then fetches the runtime from a route you mount:

```ts
// app/payload-live-preview/[file]/route.ts
import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';

export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
```

The file is named after the hash of its contents, so the response says `Cache-Control: public, max-age=31536000, immutable` and means it, and the bootstrap loads it with `integrity` and `crossorigin="anonymous"`. The route answers that one name and 404s every other, rather than returning current bytes under an old name.

`createRuntimeAssetRoute()` exists in all three route-serving adapters, each in the shape its framework wants: `export const { GET } = …` for a Next.js route file and a SvelteKit `+server.ts`, and a `Request` → `Response` function for a Nitro handler. What they answer is the same, because delivery is decided once, where the script body is built. Astro already had this as `mode: 'loader'` and keeps it — it emits and serves the file from its own build — but now reads the same asset descriptor rather than a second copy of it, and honours `runtime: LEAN_RUNTIME` there too.

`RuntimeArtifact` gained `contentHash` and `integrity`, because an artifact that can be served has to be able to name and verify itself.
