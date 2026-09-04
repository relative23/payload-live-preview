# Hybrid preview: patch, fragment, route

Patching (the default) edits the elements a page already renders. Two
things it cannot do: create markup that a template renders only when a
field is set, and run a component's own logic (derived values, custom
blocks, conditional sections). The **fragment** strategy asks your server
to render one component boundary from the unsaved form state and morphs
the result in — focus, typed values and open `<details>` survive, as with
every keyed morph (ADR 0008). The **route** strategy refreshes the whole
route when nothing smaller is safe. ADR 0011 records the protocol and its
abuse model.

## Marking a boundary

```html
<section data-payload-fragment="hero" data-payload-depends="title,tagline,body">
  <h1 data-payload-field="title">{title}</h1>
  {tagline &&
  <p class="lede">{tagline}</p>
  }
  <p>{wordCount(body)} words</p>
</section>
```

- `data-payload-fragment="hero"` — a **registry id** (`[a-z][a-z0-9-]*`).
  Never a path or a module name: the server decides what `hero` renders.
- `data-payload-depends` — the fields that re-render the boundary. Without
  it, every update does.
- `data-payload-fragment-key` — when one id renders several boundaries on a
  page (one per list item, say).
- Bindings inside the boundary still work as the **fallback**: if the
  server cannot render (network, timeout, refusal, bad response), the
  runtime patches them from the same revision and reports an `LP08xx`
  code. The editor never sees stale content presented as current.

A boundary inside an island (`<astro-island>`, `data-payload-island`) is the
island's business and is never rendered by the server.

## The endpoint (Astro)

```ts
// src/pages/payload/fragment.ts
import { createFragmentEndpoint } from 'payload-live-preview/astro';
import Hero from '../../components/Hero.astro';

export const prerender = false;

export const POST = createFragmentEndpoint({
  registry: {
    hero: {
      component: Hero,
      props: ({ fields, locale }) => ({
        title: String(fields.title ?? ''),
        tagline: typeof fields.tagline === 'string' ? fields.tagline : undefined,
        body: fields.body,
        locale,
      }),
    },
  },
  authorize: { type: 'signed-token', secret: import.meta.env.PREVIEW_SECRET, audience: SITE },
});
```

- **Registry**: the only things the endpoint can render. Props are computed
  on the server from the request's fields; nothing in the request selects
  code.
- **Authorization**: the same strategies as `authorizePreviewRequest()`
  (`payload-session`, `signed-token`, `verifier`). The endpoint authorizes
  the **page route** the browser reports, with the request's own cookies
  and query, so a token is bound to the route it was issued for and a
  session is the visitor's own. There is no unsigned endpoint.
- **Renderer**: Astro's container API (`astro/container`) by default,
  created once per process. Pass `render` to use another component system
  or to test.
- **Limits**: body 64 KiB, field depth 12, render timeout 5 s (configurable
  through `limits`). Every response is `Cache-Control: private, no-store`.

### What a deployment needs

- A route Astro serves: files under `src/pages/` whose path starts with `_`
  are private and never routed, so put the endpoint at
  `src/pages/payload/fragment.ts` (`/payload/fragment`), not under `_payload`.
- A server: an Astro SSR adapter (`@astrojs/node`, Vercel, …) with the
  endpoint route set to `prerender = false`. A static-only build has no
  process to render in; run the endpoint as a separate preview rendering
  service on the same origin (a reverse proxy path) if the site itself is
  static.
- Rate limiting at the edge or proxy for the endpoint path: each request
  renders a component. The endpoint bounds work per request (limits above)
  but does not count requests per client.
- Same-origin only. Cross-site fetches are refused (`Sec-Fetch-Site`,
  `Origin`); `allowedOrigins` on the endpoint opens it to a named origin
  when the preview page is served elsewhere.

## Turning it on in the page

Astro, request-time injection:

```ts
// src/middleware.ts
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: [ADMIN],
  authorizePreview: (request) => authorizePreviewRequest(request, strategy),
  fragments: { endpoint: '/payload/fragment' },
});
```

With `fragments` set, the injected script carries a small prelude with the
fragment client ahead of the runtime; a page without it gets the runtime
alone (its size budget does not include the client). Loader mode emits the
same prelude in the bootstrap; the runtime asset is the same for every page.
The same option exists on the other adapters and on `LivePreviewClient`
(`strategies: { fragment: createFragmentStrategy({ endpoint }) }` from
`payload-live-preview/fragment`).

## What you observe

- `fragmentRender` events per boundary and revision (`rendered` / `failed`
  with the code); `afterUpdate` carries `source: 'fragment'` once the
  revision's fragments settled, next to the `source: 'patch'` one for the
  rest of the page.
- `inspect().fragments`: `{ handler, inFlight, rendered, failed, superseded }`.
- Codes: `LP0801` request failed (network, timeout, 5xx) · `LP0802`
  response invalid (type, shape, size, wrong boundary) · `LP0803` endpoint
  refused (401/403) · `LP0804` a late response for a superseded revision
  was discarded · `LP0805` a route refresh was refused by the loop guard ·
  `LP0806` a boundary asks for `fragment` but no client is configured —
  patched instead.

## The route strategy

Some markup no boundary can own: the document head (title, meta), the
layout, route params, global providers. A binding there — anything in
`<head>`, or an element marked `data-payload-strategy="route"` (with
`data-payload-depends` naming its fields) — makes the revision a **route
refresh**: the runtime fetches the current URL again (same cookies and
query, header `x-payload-live-preview: route`), syncs `<title>`, `<meta>`
and the canonical link, morphs `<body>` in place (islands and custom
elements are boundaries it does not cross; focus, typed values and scroll
survive), rescans, and re-applies the revision so the unsaved state lands on
the fresh markup. The head sync mirrors the fresh document both ways: a
named `<meta>` or the canonical `<link>` that the server no longer renders
is removed, because the refresh is that server's own render of this URL.
Mark a tag your own script owns with `data-payload-owned` and the sync
leaves it alone in both directions. At most one refresh per revision; a second request for the
same revision, or one inside `minIntervalMs` (1 s) of the previous, is
refused with `LP0805` and the elements are patched instead. A failed
refresh (`LP0801`/`LP0802`) also falls back to patching.

The route strategy needs no endpoint: with `fragments` configured the
injected prelude carries it (`createRouteStrategy()` from
`payload-live-preview/fragment` for `LivePreviewClient` users). The server
sees a normal GET for the page, so anything that renders the page renders
the refresh.

## How a binding's strategy is chosen

In this order, and nothing else decides:

1. An explicit `data-payload-strategy` (`patch`, `fragment`, `route`; any
   other value is left alone with `LP0407`).
2. A binding inside a `data-payload-fragment` boundary belongs to the
   fragment (patched only as its fallback).
3. A binding in `<head>` belongs to the route.
4. Everything else is patched.

Several dirty fields in one revision are coalesced: each boundary renders
once if any of its `data-payload-depends` (or, without it, any field)
changed, the runtime `dependencies` option counts (a boundary depending on a
derived field re-renders when its source changes), and the route refreshes
once. `inspect().route` reports `{ handler, refreshes, failed, loopStopped }`.

## Islands on the same page

A hydrated island (`<astro-island>`, `data-payload-island`) keeps owning its
subtree: patching skips it, a fragment boundary inside it is never planned,
the route morph stops at it, and it receives every update as a
`payload-live-preview:update` event to re-render itself — with the official
`@payloadcms/live-preview-react`/`-vue` hook if that is what renders it
([interop.md](interop.md)). Patch boundaries, fragment boundaries and hook
islands coexist on one page; the hybrid fixture and its browser suite are
exactly that page.

## Revision discipline

One revision per admin message. A newer message aborts the previous
revision's fragment requests; a response that arrives late is discarded;
identical boundaries in one revision share a request; at most four
requests run at once. Slow fragment A can never overwrite fast fragment B.
