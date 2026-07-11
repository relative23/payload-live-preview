# Astro × Payload Live Preview — Example

A standalone Astro project that demonstrates `payload-live-preview`.

## Run locally

```bash
npm install     # installs Astro and the local library
npm run dev
```

Then open:

- **`http://localhost:4173/`** — preview target (would be loaded by Payload admin in production)
- **`http://localhost:4173/admin`** — mock admin panel; type into the form to see updates flow into the iframe

## What this demonstrates

| Feature | Where to look |
|---------|---------------|
| Auto-injected inline script | `astro.config.mjs` — `livePreview()` integration |
| Field bindings (text, image, array, date, link, richText) | `src/pages/index.astro` |
| postMessage protocol | `src/pages/admin.astro` |
| Schema-driven Lexical rich text | `body` field uses Lexical root JSON |
| Origin validation | Try messaging from another origin via DevTools — rejected |

## Production setup

In a real project replace `src/pages/admin.astro` with the Payload admin URL and update `allowedOrigins`:

```js
import { livePreview } from 'payload-live-preview/astro';

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
    }),
  ],
});
```
