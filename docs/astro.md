# Astro

Real-time live preview between the Payload admin and an Astro frontend: edit in the CMS, watch the iframe update. This guide goes from an empty project to a working preview and covers the three ways the runtime reaches a page.

> A hydrated React or Vue app is better served by the official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) / `-vue` hooks. This guide is for Astro and every other server-rendered or static frontend, where those hooks do not apply.

## How it works

```
Payload admin (iframe parent)                 Astro page (iframe)
  editor types in a field   ──postMessage──▶   runtime patches the
                                                bound DOM node in place
```

Elements carry `data-payload-field="…"`. The injected runtime detects that it runs inside the admin's preview iframe, listens for the admin's `postMessage` updates and writes them into the DOM. No rebuild, no reload, no client framework.

Environment names used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to, `PREVIEW_TOKEN_SECRET` the secret shared with the Payload side for signed tokens.

## 1. Install

```bash
npm install payload-live-preview
```

## 2. Add the integration

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
      // Payload 3.x: re-fetch the populated document so relationship and
      // upload fields render as content, not as IDs.
      serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
      // Required with serverURL: the population depth (0 for none).
      mergeDepth: 1,
    }),
  ],
});
```

`allowedOrigins` protects the browser's `postMessage` channel; it does not authorize the HTTP request.

### Injection modes

`mode` selects how the runtime reaches a page.

**`'inline'` (the default)** bakes the runtime into every page at build time. It works without a server, and every ordinary visitor downloads about 29 KB gzip for a feature only an editor uses.

**`'loader'`** keeps the pages small. Each page carries a bootstrap of a few hundred bytes that checks the preview context and fetches the runtime as a content-hashed, SRI-verified asset only inside a preview. The asset is published once at `/_payload-live-preview/runtime.<hash>.js` (below Astro's `base`, when one is set), cached across every page, and identical for every site on the same package version, so it carries no deployment secret. `astro dev` serves the same path from memory. The price is one extra request the first time an editor opens a preview.

```ts
livePreview({
  mode: 'loader',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
}),
```

Under a strict CSP the asset is a same-origin script with an `integrity` attribute and needs no `'unsafe-inline'`. The bootstrap is an inline `<script>` without a nonce, because a static build has no request to derive one from; its content is deterministic for a package version and configuration, so a `'sha256-…'` source expression covers it.

**`'middleware'`** injects at request time in `output: 'server'` projects, so only requests carrying preview intent receive the bytes. The integration serializes its options into the build, so it cannot carry the `authorizePreview` function the strict default requires; it refuses to build without `strict: false` (or `defaults: 'v1'`) and then delivers on intent alone:

```ts
livePreview({
  mode: 'middleware',
  strict: false, // intent-only: the query parameter alone triggers injection
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
  mergeDepth: 1,
}),
```

Intent is the query parameter (`preview`, `draft` or `livePreview` set to `true` or `1`); `previewSignals` can add `Sec-Fetch-Dest: iframe`, and `defaults: 'v1'` restores the admin referer as well. All of them are client-controlled. For a preview gated on a verified request, register `createLivePreviewMiddleware()` yourself as in step 5: it takes the hook, and the integration stays out of `astro.config.mjs`.

## 3. Annotate your markup

```astro
---
const page = await getPage(); // your existing data fetch
---
<h1 data-payload-field="title">{page.title}</h1>
<p data-payload-field="subtitle">{page.subtitle}</p>
<img data-payload-field="hero" data-payload-type="image" src={page.hero.url} alt={page.hero.alt} />
```

Rich text is detected automatically. The `<RichText />` component renders the field through the same built-in Lexical serializer the runtime uses for live patches, which reduces drift between the server render and the preview and gives an empty field a stable anchor. Exact markup parity also needs the same sanitizer availability and the same custom node and block registrations in both JavaScript realms; server-side registrations are not copied into the prebuilt inline runtime.

```astro
---
import RichText from 'payload-live-preview/astro/RichText.astro';
---
<RichText value={page.body} field="body" class="prose" />
```

That is the whole frontend. Open the page inside the admin's preview and edits appear as you type.

## 4. Point the Payload admin at your Astro URLs

In `payload.config.ts`, `admin.livePreview.url` tells the admin which frontend URL to show for each document; `buildLivePreviewUrl` from `payload-live-preview/payload` turns per-collection slug resolvers into that callback. The README's [Configure Payload](../README.md#configure-payload) section has the complete example. The helper appends `?preview=true`, which the frontend reads as preview intent — a delivery hint, not a credential. To make the iframe request verifiable without a cookie, wrap the callback and add a token from `issuePreviewToken()`; the middleware in step 5 then verifies it with the `signed-token` strategy. Both sides are in [authorization.md](authorization.md).

## 5. Authorize, then read the draft

Live preview patches the DOM after the page loads; the initial server render is still yours. Draft reads need a server-side authorization decision. `hasPreviewIntent()` only detects intent: anyone can add the query parameter or load a page in an iframe.

The middleware makes that decision through `authorizePreview`. The hook runs only on requests carrying preview intent, and a refusal leaves the response exactly as rendered: no runtime, no CSP change, no nonce in `Astro.locals`. The verified context is published as `Astro.locals.livePreviewAuthorization` and the hook's outcome (`'authorized'`, `'expired'`, `'missing-credential'`, …) as `Astro.locals.livePreviewAuthorizationOutcome`. A response the middleware changed is sent with `Cache-Control: private, no-store`. The strict default refuses to start without the hook, without explicit `allowedOrigins`, with an `http:` admin origin in production, or with referer trust; `defaults: 'v1'` opts back into the earlier behavior for a staged migration.

```ts
// src/middleware.ts
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreviewRequest } from 'payload-live-preview/server';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
  mergeDepth: 1,
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      // Forwards exactly one cookie (`payload-token`) to `/api/users/me`.
      type: 'payload-session',
      serverURL: import.meta.env.PAYLOAD_URL,
    }),
});
```

`Astro.locals` is typed through `App.Locals`; extend it once with the adapter's `LivePreviewLocals`. Every key is optional: the nonce is withheld after a refusal, and the other two exist only once the hook ran on a request carrying preview intent.

```ts
// src/env.d.ts
import type { LivePreviewLocals } from 'payload-live-preview/astro';

declare global {
  namespace App {
    interface Locals extends LivePreviewLocals {}
  }
}
```

Three strategies exist. `payload-session` is the one above. `signed-token` verifies a short-lived HMAC token the Payload side mints with `issuePreviewToken()` — bound to this site, this path, the locale and a few minutes — which is how a preview works without a cookie crossing origins. `verifier` is your own async function for an SSO or edge-auth setup; it returns claims or `null`. [authorization.md](authorization.md) has all three and the threat model behind them.

The page reuses that request-scoped decision for the draft query and for the binding attributes, instead of authorizing again or trusting the intent signal:

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
  where: { slug: { equals: Astro.params.slug ?? '' } },
  authorization, // a verified context reads the draft, null the published document
  signal: Astro.request.signal,
});
if (!result.ok || result.data === null) return new Response(null, { status: 404 });
const page = result.data;
const bindings = createPreviewBindings({ authorization, owner: `collection:pages:${page.id}` });
---
<h1 {...bindings.bind<Page>('title')}>{page.title}</h1>
```

`Page` is your document type, generated by `pll-codegen` or written by hand. `definePreview` has no draft default: `authorization` is the decision, and `depth` is written once for the read and the runtime merge (choose `0` for no relationship population). Never attach a long-lived API key or service token merely because `hasPreviewIntent()` returned `true`. One decision governs the draft flag, forwarded credentials, attribute emission, CSP changes and runtime injection together; a page cache of your own consumes the same decision.

## Fields that may be empty: `PreviewBoundary`

The runtime patches elements that exist. A field that renders nothing when empty leaves the editor with nothing to see when they fill it. The component renders the anchor always — hidden while empty, out of layout and out of the accessibility tree — and the runtime unhides it the moment a value arrives:

```astro
---
import PreviewBoundary from 'payload-live-preview/astro/PreviewBoundary.astro';
---
<PreviewBoundary field="subtitle" value={page.subtitle} as="p" class="lede">
  {page.subtitle}
</PreviewBoundary>
```

It writes `data-payload-strategy="patch"` explicitly. Markup whose conditional logic cannot be expressed as a patch target — a component that appears or disappears with its own islands and scripts — is what the fragment strategy is for.

## Fragments

Wrap such a component in a `data-payload-fragment` boundary, export an endpoint from a route with `createFragmentEndpoint()` (from `payload-live-preview/astro`), and pass its path to the integration or the middleware as `fragments: { endpoint: '/payload/fragment' }`. The runtime then posts the unsaved fields to that endpoint and morphs the server-rendered result in. A boundary on a page without a configured endpoint is patched instead and reports `LP0806` once. Markup, endpoint, registry and deployment requirements: [hybrid.md](hybrid.md).

## Gotchas

- **Empty fields need an anchor.** If you render a binding only when the field is non-empty, editing a previously-empty field has nowhere to land. Render the node unconditionally (`<div data-payload-field="subtitle">{subtitle ?? ''}</div>`) or use `PreviewBoundary`.
- **Client islands.** Bind fields in server-rendered regions. A hydrated island that re-renders a bound node overwrites the live patch; mark its root with `data-payload-island` so the runtime never patches or morphs into it ([renderers.md](renderers.md)).
- **`Referrer-Policy: no-referrer`** on the admin breaks zero-config origin detection. Set `allowedOrigins` explicitly (you already do).
- **`serverURL` credentials.** Browser-side REST merging uses `credentials: 'include'`; Payload still has to authorize that request. The initial server-side draft read forwards only the credentials the verified context carries.

## Working examples

- [`examples/astro-payload`](../examples/astro-payload) — the integration in `mode: 'loader'`, the fastest way to see the whole flow.
- [`examples/astro-inline`](../examples/astro-inline) and [`examples/astro-middleware`](../examples/astro-middleware) — the same page in the other two modes.
- [`examples/astro-hybrid`](../examples/astro-hybrid) — server-rendered fragments with a hand-composed, token-authorized middleware.

## Next

The reading path continues in [README.md](README.md): data attributes and field types in [bindings.md](bindings.md), every option in [options.md](options.md). When something does not update, [troubleshooting.md](troubleshooting.md).
