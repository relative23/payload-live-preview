# Next.js

For App Router projects on Next.js 16 whose pages are rendered on the server or at build time. The runtime patches server-rendered markup; its first write waits for React to hydrate, and a client component that re-renders a bound element can still revert a patch (see the caveat below).

Next.js 15 is not supported. Measured on 2026-09-17 with Next.js 15.5.25: 30 of the 42 end-to-end cases against [`examples/nextjs-payload`](../examples/nextjs-payload) failed with `Cannot find module 'react'`. `<LivePreviewScript />` and the fragment endpoint load `react` and `react-dom/server` through an import whose specifier is computed at runtime, which Next.js 15's server bundle does not resolve. Next.js 16 is tested with its default bundler, Turbopack; the same pages also answered under `next dev --webpack`, where webpack only warns about the computed import, but that setup is not part of the test run.

> A client-rendered React app is better served by the official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) hook: it re-renders your real component tree, so conditional sections and custom components update with full fidelity. For React Server Components, Payload's `RefreshRouteOnSave` is the save-triggered equivalent.

Environment names used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to.

## Install

```bash
npm install payload-live-preview
```

## Which of the three ways to deliver it

Next.js middleware cannot inject into the HTML body — `NextResponse.next()`
carries no body — so the script is part of the rendered HTML, and the layout or
page that owns `<head>` decides who receives it. It can reach the page three
ways, and they charge a visitor who is not an editor three different amounts.
The first two are measured per request — no cookie, no preview intent — by an
E2E case against `tests/fixtures/delivery-budgets.ts`, and the first is
measured a second time _with_ a credential, because a component that rendered
nothing for everybody would score zero on the first measurement too. The third
is what that same credential is charged: the helper builds the same bytes
either way, and the only question the component answers is who receives them.

| Way                                                       | A public visitor receives | Pick it when                                                                  |
| --------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| `<LivePreviewScript />`, an async server component        | nothing                   | the default: the render can await an authorization verdict                    |
| `livePreviewScriptProps()` with `delivery: 'asset'`       | a 1 331-byte bootstrap    | the script is built once at module scope and the page has no verdict to await |
| `livePreviewScriptProps()` or `renderLivePreviewScript()` | the whole runtime         | a page that is not gated at all, or HTML a server assembles as a string       |

## Nothing for a public visitor

`<LivePreviewScript />` is an async server component. It runs the same policy
the middleware runs — intent, then `authorizePreview` — and renders nothing at
all for a request that is not an authorized preview. Not a bootstrap: nothing.

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { LivePreviewScript } from 'payload-live-preview/nextjs';
import { authorizePreviewRequest } from 'payload-live-preview/server';

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <LivePreviewScript
          request={new Request(process.env.SITE_ORIGIN!, { headers: await headers() })}
          // A layout cannot see the query string (below), so the verdict is the gate.
          inject="always"
          allowedOrigins={[process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!]}
          serverURL={process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!}
          mergeDepth={1}
          authorizePreview={(request) =>
            authorizePreviewRequest(request, {
              type: 'payload-session',
              serverURL: process.env.PAYLOAD_URL!,
            })
          }
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

It takes the request as a prop rather than calling `next/headers` itself, so
this package still does not depend on Next — the same reason
`<LivePreviewRouteRefresh />` takes the router's refresh as one. A `Request` is
what `authorizePreview` and `shouldInject` already receive from the middleware,
so one options object serves both. Reading `headers()` makes the layout
dynamic, and that is what lets it decide per request: a page prerendered at
build time has no request to decide for, and takes the asset route below.

**Next gives a server component the request headers and cookies, but not its
URL.** A layout therefore cannot see `?preview=true`, and the default intent
signal — `previewSignals: ['query']` — cannot fire there. Two ways round it:

- `inject="always"`, as above. Intent is skipped and `authorizePreview` is the
  only gate, which is the stricter reading anyway: intent is client-controlled
  and never authorization ([authorization.md](authorization.md)).
- Render the component in a **page** instead, which does get `searchParams`, and
  pass the real URL: `new Request(url, { headers: await headers() })`. Intent
  then works as the cheap pre-filter it is, and the `signed-token` strategy —
  which binds a token to a path — has the path it needs.

The element carries a `nonce` prop for a CSP you manage yourself, and it is
rendered only when the script is. Everything else on it is the adapter options
below.

## The runtime as a cached asset

When the script is built once at module scope and there is no verdict to
await, `delivery: 'asset'` puts a bootstrap in the page instead of the runtime —
a 1 331-byte `<script>` element, measured on the example, rendered twice like
anything else in a layout's head — which arms the wait for React's first
commit ([hydration caveat](#hydration-caveat)) and fetches the runtime only
once the page finds itself in a preview context:

```ts
// app/live-preview.ts — the one thing the layout and the route must agree on
export const livePreviewOptions = {
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  mergeDepth: 1,
  delivery: 'asset',
} as const;
```

```ts
// app/payload-live-preview/[file]/route.ts
import { createRuntimeAssetRoute } from 'payload-live-preview/nextjs';
import { livePreviewOptions } from '../../live-preview';

export const { GET } = createRuntimeAssetRoute(livePreviewOptions);
```

The layout spreads the same object into `livePreviewScriptProps()` — the
synchronous helper the next section shows — so both sides name the same file.
The dynamic segment carries the content hash, and the handler answers that one name — a request for any other 404s rather than returning current bytes under an old name, which is what lets the response say `Cache-Control: public, max-age=31536000, immutable`. The bootstrap loads it with `integrity` and `crossorigin="anonymous"`; the managed CSP already allows `'self'`, and under `strictDynamic` the nonce on the bootstrap covers the script it inserts.

Move the route file and set `assetPath` together if the app is not served from the site root — the bootstrap requests exactly what `assetPath` says. With `runtime: LEAN_RUNTIME` both sides must see that option too, since the artifact decides the hash. What a proxy must not do to the file, and why: [deployment.md](deployment.md#the-runtime-as-a-cached-asset).

## The script in the root layout

`livePreviewScriptProps()` builds the same `<script>` the component renders,
for whoever is asking:

```tsx
// app/layout.tsx
import type { ReactNode } from 'react';
import { livePreviewScriptProps } from 'payload-live-preview/nextjs';

const previewScript = livePreviewScriptProps({
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  // Payload 3.x: re-fetch the populated document; mergeDepth is required with serverURL.
  serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  mergeDepth: 1,
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script {...previewScript} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

Compute the props once at module scope, as above: the configuration does not
change per request, and the script body is the same bytes every time.

The script stays inert outside the admin's preview iframe, but written this
way it ships to everyone: `livePreviewScriptProps()` is synchronous, so it
cannot wait for a verdict and does not try. Measured on the example while its
layout was still written like this: a 116 413-byte `<script>` element in a
258 227-byte response to a request with no cookie and no preview intent — and
Next renders it twice, once into the HTML and once more into the RSC flight
payload, so the runtime was most of what an anonymous visitor received. The
same request answers 15 327 bytes with `<LivePreviewScript />`. That component
is the version of this layout that waits; `delivery: 'asset'` above is the
version that keeps the module-scope props and replaces the runtime with the
1 331-byte bootstrap. What each choice costs a visitor, measured per framework:
[deployment.md](deployment.md#what-a-public-visitor-pays).

`livePreviewScriptProps()` takes a `nonce` for a CSP you manage yourself, and puts it where the framework expects it — a prop, not markup inside the body. `renderLivePreviewScript()` returns the complete `<script>` tag instead, for HTML a server assembles as a string; JSX cannot render that.

## Headers on preview requests

The adapter middleware runs `authorizePreview` on requests carrying preview intent (the query parameter `preview`, `draft` or `livePreview` set to `true` or `1`). When the hook authorizes, it merges `frame-ancestors` for the admin origin into the CSP and marks the response `private, no-store`; a refusal leaves the response untouched.

One of those headers, the cache header, is pure configuration, and `withLivePreview` writes it:

```ts
// next.config.ts
import { withLivePreview } from 'payload-live-preview/nextjs';

export default withLivePreview(nextConfig, {
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
});
```

It marks requests carrying preview intent (the same parameters, set to `true` or `1`) `private, no-store`, appending its rules to a `headers()` you already have rather than replacing it, and adds the admin's host to `allowedDevOrigins` — behind a reverse proxy the dev server sees a different origin than the browser does, and Next then rejects the admin panel's own server functions as cross-site.

It writes no `Content-Security-Policy`, and it is not a substitute for the middleware. A config rule cannot run `authorizePreview`, so it can never be where a privileged response change is decided; and Next collects every matching rule into one object keyed by header name, so a policy written there would replace the one your site already sends instead of adding to it. Measured on Next.js 16.3.4: a site whose own rule sends `frame-ancestors 'none'` answered an unauthenticated `/?preview=true` with `frame-ancestors 'self' <admin>` alone, its `script-src` gone. `frame-ancestors` for the admin origin therefore comes from `createLivePreviewMiddleware` below, which merges into an existing policy and only for a request it authorized.

```ts
// proxy.ts — Next.js 16's name for middleware.ts, which it still runs with a deprecation warning
import { NextResponse, type NextRequest } from 'next/server';
import { createLivePreviewMiddleware } from 'payload-live-preview/nextjs';
import { authorizePreviewRequest } from 'payload-live-preview/server';

const livePreview = createLivePreviewMiddleware({
  allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
  autoInject: false, // the layout already carries the script
  // Required under the strict default: without the hook the adapter refuses to start.
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      type: 'payload-session',
      serverURL: process.env.PAYLOAD_URL!,
    }),
});

export async function proxy(request: NextRequest) {
  return livePreview(request, NextResponse.next());
}
```

The strict default also requires `https:` admin origins in production and no referer trust. The three strategies — `payload-session`, `signed-token`, `verifier` — and what each one binds: [authorization.md](authorization.md).

## The decision in a page

Next.js middleware has no `locals`, so the adapter cannot publish its decision. A page that reads a draft authorizes the request itself with the same strategy and hands the context to `definePreview()`:

```tsx
// app/[slug]/page.tsx — a server component
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { authorizePreviewRequest, definePreview } from 'payload-live-preview/server';

// depth is written once for the initial read and the runtime merge.
const preview = definePreview({ serverURL: process.env.PAYLOAD_URL!, depth: 1 });

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decision = await authorizePreviewRequest(
    { url: `${process.env.SITE_ORIGIN}/${slug}`, headers: await headers() },
    { type: 'payload-session', serverURL: process.env.PAYLOAD_URL! },
  );
  const result = await preview.fetchDocument<PageDocument>({
    collection: 'pages',
    where: { slug: { equals: slug } },
    authorization: decision.context, // a verified context reads the draft, null the published document
  });
  if (!result.ok || result.data === null) notFound();
  return <h1 data-payload-field="title">{result.data.title}</h1>;
}
```

`PageDocument` is your document type. The `signed-token` strategy reads its token from the query string, so build the `url` from `searchParams` as well. A page rendered at build time has no request: it reads the published document, and the runtime patches it from there.

## Server-rendered boundaries

A patch reaches what the markup annotates. It cannot create a section the
template renders only when a field is set, and it cannot run a component's own
logic. For those, mark the region as a fragment boundary and let the server
render it from the unsaved form state:

```tsx
// app/payload/fragment/route.ts
import { createFragmentEndpoint, defineFragment } from 'payload-live-preview/nextjs';
import { Hero } from '@/components/Hero';

export const POST = createFragmentEndpoint({
  authorize: {
    type: 'signed-token',
    secret: process.env.PREVIEW_TOKEN_SECRET!,
    audience: process.env.SITE_ORIGIN!,
  },
  registry: {
    hero: defineFragment(Hero, ({ fields }) => ({ title: String(fields['title'] ?? '') })),
  },
});
```

Point the script at it — `livePreviewScriptProps({ ..., fragments: { endpoint:
'/payload/fragment' } })` in the layout above — and mark the region with
`data-payload-fragment="hero"`. `defineFragment()` ties the component to the
props it is given, so a renamed prop fails the build rather than the preview.
React is rendered with `renderToString()`, one synchronous component: a server
component that awaits its own data is not one of these, so read what it needs
in the (possibly async) props function. `react` and `react-dom` are optional
peers loaded at the first render.

Registry, limits, the fallback and the abuse model: [hybrid.md](hybrid.md).

## Hydration caveat

The runtime writes into the DOM; React does not know. Two things follow.

**The first write waits for React.** A Next page is a React tree, and React
hydrates it after the HTML has been parsed, comparing the server markup with
what it would have rendered. A value written before that is a mismatch: React
throws `Hydration failed because the server rendered text didn't match the
client`, regenerates the tree on the client, and the write is gone. So every
script this adapter emits declares `hydration: 'react'`, and under it the
runtime does not start — no `ready`, no listener — until React has committed
the tree that holds the bindings; the admin's first document then lands on
markup React keeps. On the example that is 105–115 ms after `DOMContentLoaded`
on a warm dev server. If React commits nothing within five seconds the runtime
starts anyway and reports `LP0607`; `inspect().hydration` reads
`{ mode: 'react', state }`, with `state` `waiting`, `committed` or `timed-out`
(`idle` belongs to a page that declared no hydration). How the runtime sees the commit, and what can go
wrong: [ADR 0015](architecture/0015-first-write-after-hydration.md).

**A client component that re-renders a bound element** after hydration
overwrites the patch with its own props. Bind fields in server components and
static markup, keep interactive components free of bindings, or mark a hydrated
root with `data-payload-island` so the runtime never patches or morphs into it
([renderers.md](renderers.md)).

## Route refreshes without a morph

A field nothing binds — and a section the template renders only under a
condition — can only be shown by the server's own render of the route. The
route strategy fetches that render and morphs it into the living page, which on
a Next page means writing into DOM React's reconciler owns. Give it the
router's own refresh instead and there is no morph and no second HTML request:

```tsx
// app/live-preview-refresh.tsx
'use client';
import { useRouter } from 'next/navigation';
import { LivePreviewRouteRefresh } from 'payload-live-preview/react';

export function LivePreviewRefresh() {
  return <LivePreviewRouteRefresh refresh={useRouter().refresh} />;
}
```

Render it once inside the root layout, beside the script. It takes the refresh
as a prop rather than importing `next/navigation` itself, so this package does
not depend on Next; the same component serves any router with a refresh of that
shape, and `registerRouteRefresh()` from `payload-live-preview` is the same seam
without React.

When it is not there, the strategy fetches and morphs as before.

## Example

[`examples/nextjs-payload`](../examples/nextjs-payload) on Next.js 16 — the
`(inline)` root layout with `<LivePreviewScript />`, `inject: 'always'` and a
signed-token `authorizePreview`, so an anonymous request to any of its pages
carries no runtime at all; the `(asset)` root layout with
`livePreviewScriptProps()` and `delivery: 'asset'`, for the comparison; and
`/hybrid` with its route handler at `app/(inline)/payload/fragment/route.ts`: a section
the server renders only when the field is set, a value derived from another, and
the same bindings as the fallback when the render fails. Run in Chromium,
Firefox and WebKit.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md). The doctor's preview request carries `?preview=true`; behind `authorizePreview` it needs an editor's credentials: a Payload session as `--header "Cookie: payload-token=…"`, a signed token in the URL as `?previewToken=…` (the visitor request drops it), or `--header "x-preview-token: …"` only where the strategy sets `transport: { kind: 'header' }`. Headers go with the preview request only and are never printed; the URL is printed as given.
