# Next.js

For App Router projects on Next.js 15 and 16 whose pages are rendered on the server or at build time. The runtime patches server-rendered markup; a hydrating React tree can revert those patches (see the caveat below).

> A client-rendered React app is better served by the official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) hook: it re-renders your real component tree, so conditional sections and custom components update with full fidelity. For React Server Components, Payload's `RefreshRouteOnSave` is the save-triggered equivalent.

Environment names used below: `PUBLIC_PAYLOAD_ADMIN_ORIGIN` is the admin origin the browser sees, `PAYLOAD_URL` the Payload origin server code talks to.

## Install

```bash
npm install payload-live-preview
```

## The script in the root layout

Next.js middleware cannot inject into the HTML body — `NextResponse.next()` carries no body — so the script is part of the rendered HTML:

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

The script stays inert outside the admin's preview iframe. On a static build these bytes are public and ship with every page, about 30 KB gzip. If delivery itself must be private, render the script in a dynamic layout only after the authorization below succeeded.

`livePreviewScriptProps()` takes a `nonce` for a CSP you manage yourself, and puts it where the framework expects it — a prop, not markup inside the body. `renderLivePreviewScript()` returns the complete `<script>` tag instead, for HTML a server assembles as a string; JSX cannot render that.

## Headers on preview requests

The adapter middleware runs `authorizePreview` on requests carrying preview intent (the query parameter `preview`, `draft` or `livePreview` set to `true`). When the hook authorizes, it merges `frame-ancestors` for the admin origin into the CSP and marks the response `private, no-store`; a refusal leaves the response untouched.

Behind a reverse proxy the dev server sees a different origin than the browser
does. Next then rejects the admin panel's own server functions as cross-site, so
add the public hostname to `allowedDevOrigins` in `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ['cms.example.com'],
};
```

```ts
// middleware.ts — on Next.js 16 the file is proxy.ts and the export is named `proxy`
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

export async function middleware(request: NextRequest) {
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

The runtime writes into the DOM; React does not know. A client component that re-renders a bound element after hydration overwrites the patch with its own props. Bind fields in server components and static markup, keep interactive components free of bindings, or mark a hydrated root with `data-payload-island` so the runtime never patches or morphs into it ([renderers.md](renderers.md)).

## Example

[`examples/nextjs-payload`](../examples/nextjs-payload) — the root layout with
`livePreviewScriptProps()` on Next.js 16, and `/hybrid` with its route handler
at `app/payload/fragment/route.ts`: a section the server renders only when the
field is set, a value derived from another, and the same bindings as the
fallback when the render fails. Run in Chromium, Firefox and WebKit.

## When something does not update

`__livePreview.inspect()` in the preview iframe's console names the cause in most cases; the readings, `pll doctor` and every diagnostic code are in [troubleshooting.md](troubleshooting.md).
