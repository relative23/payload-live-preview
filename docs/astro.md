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
      // Required with serverURL: the relationship population depth (0 for none).
      mergeDepth: 1,
    }),
  ],
});
```

For `output: 'server'` projects, inject at request time instead: register
`createLivePreviewMiddleware()` in `src/middleware.ts` as shown in step 5.
It authorizes each preview request and injects only into authorized
responses. The integration's `mode: 'middleware'` shorthand serializes its
options into the build, so it cannot carry the `authorizePreview` hook the
strict default requires and refuses to build; it runs only with
`strict: false` (or `defaults: 'v1'`), as intent-only delivery:

```ts
livePreview({
  mode: 'middleware',
  strict: false, // intent-only: the query parameter alone triggers injection
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
  mergeDepth: 1,
});
```

The query parameter (and, under `defaults: 'v1'`, the iframe destination
and referer) is a client-controlled intent signal: a delivery hint, not
authentication. Likewise, `allowedOrigins` protects the browser's
`postMessage` channel; it does not authorize draft access.

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
authorization. A hand-written `url` callback works identically. To make
the iframe request verifiable without a cookie, wrap the callback and add
a token from `issuePreviewToken()` — the README section "Authorized
preview URLs" shows both sides; the middleware in step 5 verifies it with
the `signed-token` strategy.

## 5. Authorize once, then fetch the initial draft

Live preview patches the DOM _after_ the page loads — the initial SSR
render is still your job. Draft reads require a real server-side
authorization decision. `hasPreviewIntent()` only detects intent; an
attacker can add its query parameter or load a page in an iframe.

The middleware makes that decision itself through `authorizePreview`. The
hook runs only on requests with preview intent, and a refusal leaves the
response exactly as rendered: no runtime, no CSP change, no nonce in
`Astro.locals`. The verified context is put on
`Astro.locals.livePreviewAuthorization` for the page, and the hook's verdict
(`'authorized'`, `'expired'`, `'missing-credential'`, …) on
`Astro.locals.livePreviewAuthorizationOutcome`. A response the middleware
changed is sent with `Cache-Control: private, no-store`. By default the
middleware refuses to start without the hook, without explicit `https` admin
origins, or with referrer trust; `defaults: 'v1'` opts back into the 1.x
behaviour for a staged migration.

```ts
// src/middleware.ts
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreviewRequest } from 'payload-live-preview';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_URL,
  mergeDepth: 1,
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      // Forwards exactly one cookie (`payload-token`) to `/api/users/me`.
      type: 'payload-session',
      serverURL: import.meta.env.PAYLOAD_URL,
    }),
});
```

Three strategies exist. `payload-session` is the one above.
`signed-token` verifies a short-lived HMAC token the Payload side mints
with `issuePreviewToken()` — bound to this site, this path, the locale and
a few minutes — which is how a preview works without a cookie crossing
origins (see the `buildLivePreviewUrl` example in the README). `verifier`
is your own async function for an SSO or edge-auth setup; it returns
claims or `null` and receives the same branded context as the others.
[ADR 0006](architecture/0006-authorized-preview-context.md) records the
threat model and what each token binding defends against.

The page reuses that request-scoped verdict for the draft query and for
the binding attributes, instead of authorizing again or trusting the
intent signal:

```ts
// src/lib/preview.ts — server-only; the adapter spreads `runtimeOptions`
import { definePreview } from 'payload-live-preview/server';
export const preview = definePreview({ serverURL: import.meta.env.PAYLOAD_URL, depth: 1 });
```

```astro
---
import { createPreviewBindings } from 'payload-live-preview/server';
import { preview } from '../lib/preview';

const authorization = Astro.locals.livePreviewAuthorization ?? null;
const result = await preview.fetchDocument<Page>({
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  authorization, // the draft decision, and the forwarded session material
  signal: Astro.request.signal,
});
if (!result.ok || result.data === null) return Astro.rewrite('/404');
const page = result.data;
const bindings = createPreviewBindings({ authorization, owner: `pages:${page.id}` });
---
<h1 {...bindings.bind<Page>('title')}>{page.title}</h1>
```

`definePreview` has no draft default: `authorization` is the decision, and
`depth` is written once for the read and the runtime merge, and is required
(choose `0` for no relationship population). The root-entry
`fetchPreviewDocument()`/`fetchPreviewGlobal()` helpers were removed in 2.0 —
use `definePreview()`. Never attach a long-lived API key or service token
merely because `hasPreviewIntent()` returned `true`. One verdict governs
the draft flag, forwarded credentials, attribute emission, CSP mutation,
and runtime injection together; your own page cache should consume the
same verdict (`Cache-Control: private, no-store` on authorized responses).

## Fields that may be empty: `PreviewBoundary`

The runtime patches elements that exist. A field that renders nothing when
empty leaves the editor with nothing to see when they fill it. The
component renders the anchor always — hidden while empty, out of layout
and out of the accessibility tree — and the runtime unhides it the moment
a value arrives:

```astro
---
import PreviewBoundary from 'payload-live-preview/astro/PreviewBoundary.astro';
---
<PreviewBoundary field="subtitle" value={page.subtitle} as="p" class="lede">
  {page.subtitle}
</PreviewBoundary>
```

It writes `data-payload-strategy="patch"` explicitly. Markup whose
conditional logic cannot be expressed as a patch target — a component that
appears or disappears with its own islands and scripts — is what the
fragment strategy (1.7.0) is for; until then such markup should say
`data-payload-strategy="fragment"` and is left alone (`LP0407`).

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
