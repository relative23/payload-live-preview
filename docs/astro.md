# Astro + Payload CMS live preview

A complete guide to wiring real-time live preview between the Payload
admin and an Astro frontend — from zero to "edit in the CMS, watch it
update in the iframe."

> Using a hydrated React/Vue app instead? Use the official
> [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) /
> `-vue` hooks. This guide is for Astro (and any server-rendered/static
> frontend), where those hooks don't apply.

## The idea in one picture

```
Payload admin (iframe parent)                 Astro page (iframe)
  editor types in a field   ──postMessage──▶   runtime patches the
                                                bound DOM node in place
```

You annotate the elements you want live-editable with
`data-payload-field="…"`. The injected runtime detects it's inside the
admin's preview iframe, listens for the admin's `postMessage` updates,
and writes them straight into the DOM. No rebuild, no reload, no React.

## 1. Install

```bash
npm install payload-live-preview
```

## 2. Add the Astro integration

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
      // Payload 3.x: re-fetch populated documents so relationship/upload
      // fields render as content, not bare IDs. Set to your Payload URL.
      serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
    }),
  ],
});
```

For `output: 'server'` projects, prefer request-time injection that
only touches preview requests (production traffic ships zero preview
bytes):

```ts
livePreview({
  mode: 'middleware',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
})
```

## 3. Annotate your markup

```astro
---
const page = await getPage(); // your existing data fetch
---
<h1 data-payload-field="title">{page.title}</h1>
<p data-payload-field="subtitle">{page.subtitle}</p>
<img data-payload-field="hero" data-payload-type="image" src={page.hero.url} alt={page.hero.alt} />
```

Rich text is detected automatically. For the best result — SSR markup
that can't drift from the live-patched markup — use the `<RichText />`
component, which renders through the same Lexical renderer the runtime
uses:

```astro
---
import RichText from 'payload-live-preview/astro/RichText.astro';
---
<RichText value={page.body} field="body" class="prose" />
```

That's the whole frontend. Open the page inside the admin's preview and
edits appear as you type.

## 4. Point the Payload admin at your Astro URLs

In `payload.config.ts`, tell the admin which frontend URL to show for
each document. `buildLivePreviewUrl` turns per-locale slug tables into
the callback:

```ts
import { buildLivePreviewUrl } from 'payload-live-preview/payload';

export default buildConfig({
  admin: {
    livePreview: {
      url: buildLivePreviewUrl({
        baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
        globals: { homepage: '/' },
        collections: {
          posts: ({ data }) => `/blog/${String(data.slug ?? '')}`,
        },
        fallback: '/',
      }),
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
      collections: ['posts'],
      globals: ['homepage'],
    },
  },
});
```

`buildLivePreviewUrl` appends `?preview=true` so the frontend recognises
the request. A hand-written `url` callback works identically.

## 5. (Recommended) Draft content on first load

Live preview patches the DOM *after* the page loads — the initial SSR
render is still your job. If you use Payload drafts, fetch the draft
version on preview requests so editors see unsaved work immediately
instead of stale published content:

```astro
---
import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';

const preview = isPreviewRequest(Astro.request);
const page = await fetchPreviewDocument<Page>({
  serverURL: import.meta.env.PAYLOAD_URL,
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  draft: preview,           // published content for normal visitors
  depth: 1,                 // keep equal to the integration's mergeDepth
  headers: { Authorization: `users API-Key ${import.meta.env.PAYLOAD_PREVIEW_KEY}` },
});
---
```

## Gotchas

- **Empty fields need an anchor.** The runtime can only patch elements
  that exist. If you render a binding only when the field is non-empty,
  editing a previously-empty field has nowhere to land. Render the node
  unconditionally: `<div data-payload-field="subtitle">{subtitle ?? ''}</div>`.
- **Client islands.** Bind fields in server-rendered regions. A hydrated
  island that re-renders a bound node will overwrite the live patch.
- **`Referrer-Policy: no-referrer`** on the admin breaks zero-config
  origin detection — set `allowedOrigins` explicitly (you already do).
- **`serverURL` credentials.** The REST merge needs the editor's cookie
  (same-site) or CORS `credentials` to reach the Payload API.

## Working example

A runnable Astro × Payload example (used as the E2E fixture) lives in
[`examples/astro-payload`](../examples/astro-payload). It's the fastest
way to see the whole flow end to end.

## Reference

- Data attributes, field types, events, plugins, security model: the
  main [README](../README.md).
- Payload-side `admin.livePreview` contract (breakpoints, url callback):
  the [official docs](https://payloadcms.com/docs/live-preview/overview).
