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

For `output: 'server'` projects, request-time injection can limit the
bytes to requests carrying preview intent:

```ts
livePreview({
  mode: 'middleware',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
});
```

The integration's query, iframe-destination, and referer checks are
client-controlled intent signals. They are useful as a delivery
optimisation, but they do not authenticate the HTTP request. Likewise,
`allowedOrigins` protects the browser's `postMessage` channel; it does
not authorize draft access. If script injection or CSP changes are
privileged in your application, use the manual, authorization-gated
middleware composition in step 5 instead of relying on this shorthand.

## 3. Annotate your markup

```astro
---
const page = await getPage(); // your existing data fetch
---
<h1 data-payload-field="title">{page.title}</h1>
<p data-payload-field="subtitle">{page.subtitle}</p>
<img data-payload-field="hero" data-payload-type="image" src={page.hero.url} alt={page.hero.alt} />
```

Rich text is detected automatically. The `<RichText />` component uses
the same built-in Lexical serializer as live patches, reducing drift and
providing a stable empty-field anchor. Exact markup parity requires
equivalent sanitizer availability/configuration and the same custom
node/block registrations in both JavaScript realms; server-side
registrations are not copied into the prebuilt inline runtime:

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
preview intent. The query parameter is not a credential or proof of
authorization. A hand-written `url` callback works identically.

## 5. Authorize once, then fetch the initial draft

Live preview patches the DOM _after_ the page loads — the initial SSR
render is still your job. Draft reads require a real server-side
authorization decision. `isPreviewRequest()` only detects intent; an
attacker can add its query parameter or load a page in an iframe.

For an SSR project, compose the manual adapter behind application-owned
authentication. The verifier below is deliberately a local import, not
a package API: implement it by validating the current user's Payload
session, or a short-lived signed preview authorization bound to the
expected audience, route, and expiry. Have it return only the minimum
request-scoped Payload headers needed by the page fetch.

```ts
// src/middleware.ts
import { createLivePreviewMiddleware, isPreviewRequest } from 'payload-live-preview/astro';
import { verifyAppPreviewSession } from './lib/server/preview-auth';

const ADMIN = import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN;
const applyLivePreview = createLivePreviewMiddleware({
  allowedOrigins: [ADMIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
});

export const onRequest = async (context, next) => {
  const hasPreviewIntent = isPreviewRequest(context.request, {
    adminOrigins: [ADMIN],
  });
  const authorization = hasPreviewIntent ? await verifyAppPreviewSession(context.request) : null;

  // Fail closed: no draft credentials, injection, CSP mutation, or
  // private-cache response for an unauthorised request.
  if (authorization === null) return next();

  context.locals.previewAuthorization = authorization;
  const response = await applyLivePreview(context, next);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
```

The page reuses that request-scoped result for the draft query instead
of authorizing again or trusting the intent signal:

```astro
---
import { fetchPreviewDocument } from 'payload-live-preview';

const authorization = Astro.locals.previewAuthorization ?? null;
const page = await fetchPreviewDocument<Page>({
  serverURL: import.meta.env.PAYLOAD_URL,
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  draft: authorization !== null, // published for unauthorised/normal traffic
  depth: 1,                      // keep equal to the integration's mergeDepth
  ...(authorization === null ? {} : { headers: authorization.payloadHeaders }),
});
---
```

`fetchPreviewDocument()` and `fetchPreviewGlobal()` build REST queries;
they do not authenticate them. Their `draft` option defaults to `true`
in 1.x for compatibility, so set it explicitly. Never attach a
long-lived API key or service token merely because
`isPreviewRequest()` returned `true`. The single verified authorization
above governs the draft flag, forwarded credentials, cache policy, CSP
mutation, and runtime injection together.

## Gotchas

- **Empty fields need an anchor.** The runtime can only patch elements
  that exist. If you render a binding only when the field is non-empty,
  editing a previously-empty field has nowhere to land. Render the node
  unconditionally: `<div data-payload-field="subtitle">{subtitle ?? ''}</div>`.
- **Client islands.** Bind fields in server-rendered regions. A hydrated
  island that re-renders a bound node will overwrite the live patch.
- **`Referrer-Policy: no-referrer`** on the admin breaks zero-config
  origin detection — set `allowedOrigins` explicitly (you already do).
- **`serverURL` credentials.** Browser-side REST merging uses
  `credentials: 'include'`; Payload still has to authorize that request.
  Initial server-side draft fetches should forward only the minimal
  credentials produced by the verified request-scoped authorization.

## Working example

A runnable Astro × Payload example (used as the E2E fixture) lives in
[`examples/astro-payload`](../examples/astro-payload). It's the fastest
way to see the whole flow end to end.

## Reference

- Data attributes, field types, events, plugins, security model: the
  main [README](../README.md).
- Payload-side `admin.livePreview` contract (breakpoints, url callback):
  the [official docs](https://payloadcms.com/docs/live-preview/overview).
