# payload-live-preview

[![CI](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](package.json)
[![Payload 2.x / 3.x](https://img.shields.io/badge/Payload-2.x%20%2F%203.x-black)](https://payloadcms.com)
[![npm](https://img.shields.io/npm/v/payload-live-preview?color=cb3837&logo=npm)](https://www.npmjs.com/package/payload-live-preview)

> **Live preview for Payload CMS in Astro** — and any other server-rendered or static frontend (SvelteKit, Nuxt, Next.js, plain HTML).

**The missing piece for Astro + Payload.** The official live-preview packages are React/Vue hooks — great for a hydrated SPA, but useless for an Astro site. This package makes the CMS's real-time preview work where there is no client framework to re-render: annotate your `.astro` markup with `data-payload-field`, add one line to `astro.config.mjs`, and edits stream into the preview iframe as the editor types. No rebuild, no page reload, no React.

Under the hood it's framework-agnostic — the same runtime drives SvelteKit, Nuxt, Next.js (static/SSR) and plain HTML — but Astro is the first-class, end-to-end-tested path.

**→ New to this? Start with the [Astro + Payload live preview guide](docs/astro.md) — zero to working preview in five steps.**

## Highlights

| | |
|---|---|
| **Single source of truth** | One TypeScript runtime compiled to a self-contained IIFE (~57 KB raw, ~19 KB gzipped) at build time — no parallel inline/class implementations to drift. |
| **Payload 3.x native** | Optional REST data merging (`serverURL`) re-fetches populated documents exactly like the official client, so relationship and upload fields render as content, not as bare IDs. |
| **Complete Lexical renderer** | 16 node types incl. `upload`, `relationship`, `block`, `autolink`, `tab`, indent, RTL — plus automatic rich-text detection, so `data-payload-field` alone is enough. |
| **Preview-gated injection** | Server adapters inject the runtime only into preview requests (`?preview=true`, `Sec-Fetch-Dest: iframe`, admin referer) — production traffic is untouched. |
| **Strict security** | Escape-by-default sanitizer with curated whitelist, URL and `srcset` validation, prototype-pollution guards, policed attribute writes, CSP helpers with union-merge. |
| **Per-instance** | No module-level singletons — multiple clients coexist, `destroy()` only affects its own listeners. |
| **Typed DSL + codegen** | `pll-codegen` emits TypeScript interfaces from your `payload.config.ts`; `bind<T>()` gives compile-time-checked field bindings. |
| **First-class adapters** | Astro (integration + middleware), Next.js, SvelteKit, Nuxt — all share the same core. |

## Compatibility

| | Payload 2.x | Payload 3.x |
|---|---|---|
| Scalar field updates | ✅ | ✅ |
| Rich text (Lexical) | ✅ | ✅ |
| Relationship / upload population | ✅ (admin merges client-side) | ✅ with `serverURL` (REST merge) |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅ | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) |

Astro **4 – 7** (E2E-tested on 4.16 and 7.0), Node ≥ 20.19. Protocol verified against `@payloadcms/live-preview` 3.86 (a weekly CI job watches for wire-format drift).

**When to use the official packages instead:** for a client-rendered React or Vue app, [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) / `-vue` re-render your real component tree and are maintained in lockstep with Payload — that is the better tool there. This package exists for everything the official hooks cannot cover: Astro, static/SSR pages, SvelteKit/Nuxt server-rendered markup, plain HTML — anywhere there is no client framework to re-render the page.

## Install

```bash
npm install payload-live-preview
```

## Configure Payload

Enable live preview in `payload.config.ts` — the `url` callback maps the edited document to the frontend URL shown in the preview iframe. `buildLivePreviewUrl` replaces the usual lookup-table boilerplate:

```ts
import { buildLivePreviewUrl } from 'payload-live-preview/payload';

export default buildConfig({
  admin: {
    livePreview: {
      url: buildLivePreviewUrl({
        baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
        collections: {
          posts: ({ data }) => `/blog/${String(data.slug ?? '')}`,
          services: ({ data, locale }) => `/${locale}/services/${String(data.slug ?? '')}`,
        },
        globals: {
          homepage: '/',
        },
        fallback: '/', // new drafts without a slug land here
      }),
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
      collections: ['posts', 'services'],
      globals: ['homepage'],
    },
  },
});
```

The helper appends `?preview=true` automatically so the adapters' preview detection recognises the request. A hand-written `url: ({ data, locale, collectionConfig, globalConfig }) => string` callback works exactly the same — see the [official docs](https://payloadcms.com/docs/live-preview/overview) for the full contract.

## Quick start

### Astro

```ts
// astro.config.mjs
import { defineConfig } from 'astro/config';
import { livePreview } from 'payload-live-preview/astro';

export default defineConfig({
  integrations: [
    livePreview({
      allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
      // Payload 3.x: populate relationship/upload fields via REST merge
      serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
    }),
  ],
});
```

Annotate the elements you want bound:

```astro
<h1 data-payload-field="title">{title}</h1>
<div data-payload-field="body">…server-rendered rich text…</div>
<img data-payload-field="hero" alt={alt} src={url} />
```

That's it — the inline script auto-detects the iframe context and starts updating. Rich text is detected automatically from the value shape; `data-payload-richtext` is only needed to force it.

For rich text, the `<RichText />` component renders the field **through the same Lexical renderer the runtime uses for live patches** — SSR markup and preview updates cannot diverge, and the binding plus the empty-anchor pattern come for free:

```astro
---
import RichText from 'payload-live-preview/astro/RichText.astro';
---
<RichText value={page.body} field="body" class="prose" />
```

**Injection modes.** The default (`mode: 'inline'`) bakes the runtime into every page at build time — right for `output: 'static'`, where no middleware runs at request time. For SSR projects (`output: 'server'`), switch to request-time injection that touches **only preview requests**:

```ts
livePreview({
  mode: 'middleware',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
}),
```

This auto-registers the preview middleware: it detects preview requests (`?preview=true` / `?draft=true` query, `Sec-Fetch-Dest: iframe`, or an admin referer — restrict via `previewSignals: ['query']` for high-security setups), injects the script into their `<head>`, and merges a `frame-ancestors` CSP directive so the admin may embed the page. Everything else streams through untouched; prerendered pages are skipped. The same middleware can also be registered manually via `createLivePreviewMiddleware()` in `src/middleware.ts` (needed when you want a `shouldInject` callback).

If you already have your own middleware, compose with the exported building blocks instead:

```ts
import { isPreviewRequest, mergeCspHeader, buildFrameAncestors } from 'payload-live-preview';

if (isPreviewRequest(request, { adminOrigins: [ADMIN] })) {
  headers.set('content-security-policy', mergeCspHeader(existing, {
    'frame-ancestors': buildFrameAncestors({ origins: [ADMIN] }),
  }));
}
```

### Next.js (App Router)

> **Client-rendered React app?** Use the official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) (`useLivePreview`) instead — it re-renders your real component tree, so conditional sections and custom components update with full fidelity, and it ships in lockstep with Payload. This package's DOM patching targets **server-rendered/static markup**; a hydrating React tree can revert its patches on re-render. For React Server Components, Payload's `RefreshRouteOnSave` is the save-triggered equivalent.

For statically rendered pages, embed the script in the root layout — Next middleware cannot inject into the HTML body (a `NextResponse.next()` carries no body), so use it for CSP headers only:

```tsx
// app/layout.tsx — script executes because it is part of the SSR HTML
import { generateInlineScript } from 'payload-live-preview';

const previewScript = generateInlineScript({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
  serverURL: process.env.PAYLOAD_ADMIN_ORIGIN!,
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <script dangerouslySetInnerHTML={{ __html: previewScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

```ts
// middleware.ts — frame-ancestors on preview requests
import { NextResponse, type NextRequest } from 'next/server';
import { createLivePreviewMiddleware } from 'payload-live-preview/nextjs';

const livePreview = createLivePreviewMiddleware({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
  autoInject: false,
});

export async function middleware(request: NextRequest) {
  return livePreview(request, NextResponse.next());
}
```

### SvelteKit

```ts
// src/hooks.server.ts
import { livePreviewHandle } from 'payload-live-preview/sveltekit';
export const handle = livePreviewHandle({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
  serverURL: process.env.PAYLOAD_ADMIN_ORIGIN!,
});
```

### Nuxt 3

```ts
// server/plugins/live-preview.ts
import { livePreviewNitroPlugin } from 'payload-live-preview/nuxt';

export default defineNitroPlugin(
  livePreviewNitroPlugin({
    allowedOrigins: [process.env.NUXT_PUBLIC_PAYLOAD_ADMIN_ORIGIN!],
    serverURL: process.env.NUXT_PUBLIC_PAYLOAD_ADMIN_ORIGIN!,
  }),
);
```

The plugin hooks `render:html`, injects the script into preview responses, and merges the CSP header. For manual embedding use `renderLivePreviewScript()` with `useHead`.

> Same caveat as Next.js: DOM patches apply to the server-rendered markup. A hydrated Vue island that re-renders the bound nodes will overwrite them — bind fields in server-rendered regions, or use the official `@payloadcms/live-preview-vue` composable inside client components.

### Plain HTML (advanced)

```ts
import { generateInlineScript, wrapWithScriptTag } from 'payload-live-preview';
const script = generateInlineScript({
  allowedOrigins: ['https://admin.example.com'],
  serverURL: 'https://admin.example.com',
});
// Inject via `<script>${script}</script>` — or wrapWithScriptTag(script, { nonce }).
```

## Payload 3.x: populated relationships (`serverURL`)

Payload 3.x posts **raw form values** on every edit — relationship and upload fields arrive as bare IDs. Set `serverURL` (any adapter, the inline generator, or the client) and the runtime re-fetches each update through the Payload REST API (`X-Payload-HTTP-Method-Override: GET`, `credentials: 'include'` — the same strategy as the official `@payloadcms/live-preview` client). The response is the populated document.

Requirements: the preview page must be able to reach the Payload API with the editor's credentials (same-site cookies, or CORS with `credentials`). On failure the runtime falls back to rendering the raw values. Tune with `apiRoute` (default `/api`) and `mergeDepth` (default `1`).

⚠️ **`mergeDepth` must match the `depth` of your initial page fetch.** If the page was rendered from a `depth=2` query but merges arrive with `depth=1`, nested relationships that were objects on first load degrade to IDs after the first edit — the same footgun the official docs warn about for their `depth` option.

## Draft documents on first load

Live preview patches the DOM **after** the page has loaded — the initial server render is your job. If you use Payload drafts, fetch draft content when rendering a preview request, otherwise editors see stale published content until their first keystroke. `fetchPreviewDocument` / `fetchPreviewGlobal` wrap the query with the right flags:

```ts
// Astro example — in your page/loader code
import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';

const page = await fetchPreviewDocument<Page>({
  serverURL: import.meta.env.PAYLOAD_URL,
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  draft: isPreviewRequest(Astro.request), // published for normal traffic
  depth: 1, // keep equal to mergeDepth!
  headers: { Authorization: `users API-Key ${import.meta.env.PAYLOAD_PREVIEW_KEY}` },
});
```

## Data-attribute reference

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `data-payload-field` | Bind element to a Payload field path | `data-payload-field="hero.title"` |
| `data-payload-type` | Force a specific renderer | `data-payload-type="image"` |
| `data-payload-attribute` | Write the value into an attribute instead of content (unsafe attributes and URLs are refused) | `data-payload-attribute="datetime"` |
| `data-payload-href` | Read `href` from a sibling field | `data-payload-href="ctaUrl"` |
| `data-payload-src` | Read `src` from a sibling field | `data-payload-src="hero.url"` |
| `data-payload-alt` | Read `alt` from a sibling field | `data-payload-alt="hero.alt"` |
| `data-payload-richtext` | Force Lexical rendering (usually auto-detected) | `data-payload-richtext` |
| `data-payload-html` | Render value as sanitised HTML | `data-payload-html` |
| `data-payload-array` | Treat value as an array | `data-payload-array` |
| `data-payload-array-template` | HTML template per array item | `data-payload-array-template="<li>{{title}}</li>"` |
| `data-payload-array-separator` | Separator for primitive arrays | `data-payload-array-separator=" · "` |
| `data-payload-structural` | Use diff-based structural updates | `data-payload-structural` |
| `data-payload-locale` | Override locale for this element | `data-payload-locale="de-AT"` |

**Empty-field gotcha:** the runtime can only patch elements that exist. If your template renders a binding only when the field is non-empty, editing a previously-empty field has nowhere to land. Render the anchor unconditionally:

```astro
<div data-payload-field="subtitle">{subtitle ?? ''}</div>
```

## Field types

`text` · `textarea` · `richText` · `html` · `email` · `number` · `checkbox` · `date` · `select` · `radio` · `relationship` · `upload` · `image` · `url` · `array` · `blocks` · `structural-array`

Custom renderers register via the plugin system:

```ts
import { LivePreviewClient } from 'payload-live-preview';

const client = new LivePreviewClient({ allowedOrigins: ['https://admin.example.com'] });
await client.use({
  name: 'currency',
  init: (ctx) => {
    ctx.registerFieldRenderer({
      name: 'text',
      render: (target, value) => {
        target.element.textContent = new Intl.NumberFormat('de-AT', {
          style: 'currency',
          currency: 'EUR',
        }).format(Number(value));
      },
    });
  },
});
```

## Typed bindings and codegen

Generate interfaces straight from your Payload config:

```bash
npx pll-codegen --config ../backend/src/payload.config.ts --out src/lib/bind-types.ts
```

(`ts-morph` must be installed — it is an optional peer dependency. Flags: `-c/--config`, `-o/--out`, `--tsconfig`, `-q/--quiet`.)

Then bind with compile-time checking:

```astro
---
import { bind } from 'payload-live-preview';
import type { Homepage } from '../lib/bind-types';
---
<h1 {...bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
<img {...bind<Homepage>('heroImage', { attribute: 'src' })} />
```

`bind('title')` emits `data-payload-field="title"`; misspelled field names fail the build. `bindByPath<T>(d => d.hero.title)` is the rename-safe proxy variant. There is also an Astro codegen integration: `import { livePreviewCodegen } from 'payload-live-preview/codegen/astro'`.

## Events and plugins

```ts
const client = new LivePreviewClient({ allowedOrigins: [ADMIN] });

client.events.on('connect', (e) => console.log('connected to', e.origin));
client.events.on('beforeUpdate', (e) => { if (frozen) e.cancel(); });
client.events.on('documentSave', () => location.reload());
```

Events: `init` · `connect` · `disconnect` · `beforeUpdate` · `afterUpdate` · `elementUpdate` · `documentSave` · `cacheRefresh` · `error` · `destroy`.

Built-in plugins:

| Plugin | Effect |
|--------|--------|
| `highlightPlugin` | Flashes an outline on updated elements (respects reduced-motion). |
| `debugPlugin` | Logs every lifecycle event to the console. |
| `createAnalyticsPlugin()` | Collects update statistics, exposed via `getStats()`. |
| `documentSavePlugin({ strategy })` | Reacts to admin saves: `'silent'` · `'reload'` (scroll-preserving) · `'revalidate'` · `'fetch'`. |

## Configuration reference

Options accepted by `generateInlineScript`, the adapters, and `LivePreviewClient`:

| Option | Default | Meaning |
|--------|---------|---------|
| `allowedOrigins` | `[]` | Trusted admin origins (recommended in production). |
| `serverURL` | — | Payload origin for REST data merging (Payload 3.x population). |
| `apiRoute` | `/api` | REST route prefix used with `serverURL`. |
| `mergeDepth` | `1` | Population depth used with `serverURL`. |
| `debug` | `false` | Verbose console logging. |
| `debounceMs` | `50` | Debounce window for incoming updates. |
| `heartbeatMs` | `0` (off) | Idle timeout. Leave off — Payload sends no keepalive. |
| `enableA11y` | `true` | `aria-live` region announcing connect/update/disconnect. |
| `disableVisibilityGate` | `false` | Apply updates to off-screen elements immediately. |
| `visibilityGateThreshold` | `50` | Cache size above which off-screen updates are queued. |
| `intersectionRootMargin` | `'200px'` | Pre-render margin for the visibility gate. |
| `disableReferrerDetection` | `false` | Opt out of `document.referrer` origin auto-detection. |
| `disableLocalhostMatching` | `false` | Opt out of dev-mode localhost origin matching. |

Adapter-only options: `inject` (`'preview-only'` default / `'always'`), `previewQueryParams`, `previewSignals` (restrict which signals count — `['query']` for strict setups), `autoInject`, `shouldInject`, `manageCsp` (`'frame-ancestors'` default / `'full'` / `false`), `strictDynamic`, `frameAncestorsExtra`, `scriptSrcExtra`, `nonce`; Astro integration additionally: `mode` (`'inline'` / `'middleware'`).

Bundle-size note: `import … from 'payload-live-preview/core'` is a lighter entry without the Lexical renderer, plugins, and inline generator. Hot-path timings live in [docs/benchmarks.md](docs/benchmarks.md).

All three framework wirings are E2E-tested against real apps in `examples/` (Astro 7, Next.js 16, SvelteKit 2 — Chromium, Firefox and WebKit).

## Security model

- **Origin validation** — every incoming `postMessage` is checked against explicit `allowedOrigins` plus (in dev) a localhost pattern. `document.referrer` is a **zero-config fallback only**: the moment you configure explicit origins, the referrer is ignored — a foreign site framing your page can never widen a pinned allow-list. After the first valid handshake the detector locks to that exact origin. ⚠️ In referrer-fallback mode any site that frames the page becomes a trusted sender — the runtime logs a warning; set explicit `allowedOrigins` and serve a `frame-ancestors` CSP in production (the adapters do the latter by default on preview responses).
- **HTML sanitisation** — Lexical output and HTML-typed fields run through an isomorphic DOM sanitiser with a curated tag/attribute whitelist (media tags allowed; `<script>`, `<form>`, `<iframe>`, `<svg>`, event handlers, `style` rejected; `srcset` candidates URL-validated).
- **URL validation** — every URL that lands in `href`/`src`/`srcset`/`poster` must be `http(s)` / `mailto:` / `tel:` / relative; `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` are rejected (case-insensitive, whitespace-tolerant). External links — including protocol-relative ones — get `rel="noopener noreferrer"`.
- **Policed attribute writes** — `data-payload-attribute` refuses event handlers, `style`, `srcdoc`, `formaction`, `id`/`name` (DOM clobbering) and validates URL attributes.
- **CSP-friendly** — adapters merge `frame-ancestors` for the admin origins without clobbering your existing policy; opt-in `manageCsp: 'full'` manages a per-request nonce'd `script-src` (`'strict-dynamic'` opt-in — it disables `'self'`/host sources in CSP 3).
- **No prototype pollution** — nested field lookups refuse `__proto__`, `prototype`, `constructor`; incoming data is never merged into existing objects.

Full details in [docs/security.md](docs/security.md). Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Troubleshooting

- **Nothing updates** — open the browser console inside the preview iframe (enable `debug: true`). The most common causes: the admin origin is not in `allowedOrigins`; the page is not actually loaded in an iframe; the binding element does not exist (see the empty-field gotcha above — the runtime warns about orphan updates in debug mode).
- **Relationship fields show IDs** — set `serverURL` (Payload 3.x sends unpopulated form values).
- **`Referrer-Policy: no-referrer`** on the admin breaks zero-config origin detection — set `allowedOrigins` explicitly.
- **Preview iframe refuses to load** — your host sets `X-Frame-Options` or a restrictive `frame-ancestors`. The adapters' CSP management overrides `frame-ancestors` on preview responses, but `X-Frame-Options: DENY` from a proxy must be removed for preview requests.

## License

MIT © relative23
