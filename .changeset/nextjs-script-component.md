---
'payload-live-preview': minor
---

New: **`<LivePreviewScript />`** from `payload-live-preview/nextjs` — a Next.js
delivery that charges a public visitor nothing.

Until now a Next.js project put the script in its root layout by spreading
`livePreviewScriptProps()`. That helper is synchronous, so it cannot wait for an
authorization verdict and does not try: it builds the script for whoever is
asking, and a root layout renders for everyone. Measured on a real site, a
request with no cookie and no preview intent came back with 195 342 of 254 707
bytes of preview runtime — 77 % of the page. Next renders a layout's `<head>`
twice, once into the HTML and once more into the RSC flight payload underneath
it, so the runtime shipped twice as well.

`<LivePreviewScript />` is an async server component. It runs the same policy
the middleware runs — preview intent, then `authorizePreview` — and renders
nothing at all for a request that is not an authorized preview. Not a bootstrap:
nothing, the same as the Astro middleware, the SvelteKit `handle` and the Nuxt
Nitro plugin already deliver.

```tsx
// app/layout.tsx
import { headers } from 'next/headers';
import { LivePreviewScript } from 'payload-live-preview/nextjs';
import { authorizePreviewRequest } from 'payload-live-preview/server';

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <LivePreviewScript
          request={new Request(process.env.SITE_ORIGIN!, { headers: await headers() })}
          inject="always"
          allowedOrigins={[process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN!]}
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

It takes the request as a prop rather than importing `next/headers` itself, the
same reason `<LivePreviewRouteRefresh />` takes the router's refresh as one:
`next` is not a dependency of this package. A `Request` is what
`authorizePreview` and `shouldInject` already receive from the middleware, so one
options object serves both.

Next hands a server component the request headers and cookies but not its URL, so
a layout cannot see `?preview=true` and the default `previewSignals: ['query']`
cannot fire there. `inject: 'always'` makes the authorization hook the only gate,
which is the stricter reading anyway; a **page** gets `searchParams` and can pass
the real URL, which the `signed-token` strategy needs because it binds a token to
a path. Both recipes are in `docs/nextjs.md`.

`livePreviewScriptProps()` and `renderLivePreviewScript()` are unchanged and stay:
the first for a layout that is not gated, the second for HTML a server assembles
as a string. `delivery: 'asset'` remains the answer for a script built once at
module scope — a 696-byte bootstrap instead of the runtime. What each choice costs
a visitor, measured: `docs/deployment.md`.
