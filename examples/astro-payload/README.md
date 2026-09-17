# Astro × Payload Live Preview — Example

An Astro project that demonstrates `payload-live-preview` against a mock admin,
and an E2E fixture: the Astro matrix and the default real-admin E2E run against
it. It installs the package from this repository (`file:../..`, with
`install-links=true` in `.npmrc`), so it runs whatever the root build put in
`dist/`.

## Run locally

```bash
npm run build   # in the repository root: the build this example installs
cd examples/astro-payload
npm install     # installs Astro and a packed copy of that build
npm run dev
```

A later build does not reach an existing install on its own:
[Refresh after a build](../README.md#refresh-after-a-build).

Then open:

- **`http://localhost:4173/`** — preview target (the Payload admin frames it in production)
- **`http://localhost:4173/admin`** — mock admin panel; type into the form to see updates flow into the iframe

## What this demonstrates

| Feature                                                                                                      | Where to look                                             |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Loader delivery: each page carries a bootstrap that fetches the content-hashed runtime only inside a preview | `astro.config.mjs` — `livePreview({ mode: 'loader' })`    |
| Field bindings (text, image, number, array, date, link, rich text)                                           | `src/pages/index.astro`                                   |
| postMessage protocol                                                                                         | `src/pages/admin.astro`                                   |
| Lexical rich text rendered on the server by `RichText.astro`                                                 | `body` in `src/pages/index.astro`                         |
| A DOM for the server-side sanitizer (`setSanitizerDocument()` with linkedom)                                 | `src/sanitizer.ts`                                        |
| Origin validation                                                                                            | Try messaging from another origin via DevTools — rejected |

## Production setup

In a real project the Payload admin frames the page instead of
`src/pages/admin.astro`. On the Payload side, `admin.livePreview.url` in
`payload.config.ts` points the admin's iframe at the page; `buildLivePreviewUrl()`
from `payload-live-preview/payload` builds that callback and appends
`?preview=true` ([Configure Payload](../../README.md#configure-payload)). On the
Astro side:

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

// astro.config.mjs gets no PUBLIC_ variables through import.meta.env: read the
// process environment, or load .env yourself with Vite's loadEnv().
const ADMIN = process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN;

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [ADMIN],
      // Payload 3.x posts relationship and upload fields as IDs: serverURL
      // re-fetches the populated document, and mergeDepth is required with it.
      serverURL: ADMIN,
      mergeDepth: 1,
      // Without `mode`, the whole runtime is inlined into every page.
      mode: 'loader',
    }),
  ],
});
```
