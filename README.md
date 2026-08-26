# payload-live-preview

[![CI](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](package.json)
[![Payload 2.x / 3.x](https://img.shields.io/badge/Payload-2.x%20%2F%203.x-black)](https://payloadcms.com)
[![npm](https://img.shields.io/npm/v/payload-live-preview?color=cb3837&logo=npm)](https://www.npmjs.com/package/payload-live-preview)

> **Live preview for Payload CMS in Astro** — and any other server-rendered or static frontend (SvelteKit, Nuxt, Next.js, plain HTML).

**The missing piece for Astro + Payload.** The official live-preview packages are React/Vue hooks — great when a hydrated component tree owns the rendering, but they cannot directly re-render server-produced Astro markup. This package makes the CMS's real-time preview work where there is no client framework to re-render: annotate your `.astro` markup with `data-payload-field`, add one line to `astro.config.mjs`, and edits stream into the preview iframe as the editor types. No rebuild, no page reload, no React.

Under the hood it's framework-agnostic — the same runtime drives SvelteKit, Nuxt, Next.js (static/SSR) and plain HTML — but Astro is the first-class, end-to-end-tested path.

**→ New to this? Start with the [Astro + Payload live preview guide](docs/astro.md) — zero to working preview in five steps.**

## Highlights

|                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single source of truth**    | One TypeScript runtime compiled to a self-contained IIFE (~64 KB raw, ~21 KB gzipped) at build time — no parallel inline/class implementations to drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Payload 3.x native**        | Optional REST data merging (`serverURL`) re-fetches populated documents exactly like the official client, so relationship and upload fields render as content, not as bare IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Complete Lexical renderer** | 16 node types incl. `upload`, `relationship`, `block`, `autolink`, `tab`, indent, RTL — plus automatic rich-text detection, so `data-payload-field` alone is enough.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Intent-gated delivery**     | Server adapters can limit runtime delivery to requests carrying preview-intent signals (`?preview=true`, `Sec-Fetch-Dest: iframe`, admin referer). Those client-controlled signals are an optimisation, never authorization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Strict security**           | Escape-by-default sanitizer with curated whitelist, URL and `srcset` validation, prototype-pollution guards, policed attribute writes, CSP helpers with union-merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Per-instance**              | Event emitters, plugins, field-renderer layers, connections, and structural-diff memory live on each client. Multiple programmatic clients coexist, and each `destroy()` tears down only its own resources. Stateful built-in renderers are recreated per client; explicit Lexical-node, block, and built-in-renderer registrations are module/realm-wide configuration (built-in renderer registrations affect future client snapshots). The separate inline global API clears its `window.__livePreview` handle when destroyed. The built-in highlight plugin and accessibility announcer use narrow, DOM-keyed, reference-counted `WeakMap` leases solely to coordinate shared style, class, and live-region ownership across clients. |
| **Typed DSL + codegen**       | `pll-codegen` emits TypeScript interfaces from your `payload.config.ts`; `bind<T>()` gives compile-time-checked field bindings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **First-class adapters**      | Astro (integration + middleware), Next.js, SvelteKit, Nuxt — all share the same core.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Compatibility

|                                                | Payload 2.x                   | Payload 3.x                                                           |
| ---------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Scalar field updates                           | ✅                            | ✅                                                                    |
| Rich text (Lexical)                            | ✅                            | ✅                                                                    |
| Relationship / upload population               | ✅ (admin merges client-side) | ✅ with `serverURL` (REST merge)                                      |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅                            | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) |

Astro **4 – 7** is the supported peer range; the current real-app browser fixture exercises Astro 7, not every supported Astro major. Node ≥ 20.19. Protocol compatibility is covered by captured-message integration tests plus a weekly `@payloadcms/live-preview` latest/canary drift check.

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

The helper appends `?preview=true` automatically so the adapters detect preview intent. That query parameter is client-controlled and does not authorize draft access or response changes. A hand-written `url: ({ data, locale, collectionConfig, globalConfig }) => string` callback works exactly the same — see the [official docs](https://payloadcms.com/docs/live-preview/overview) for the full contract.

**Documents without a preview target.** Not every document has a reachable
route: a draft with no slug yet, a collection that is never rendered, a
document whose id is missing. Payload's `url` callback accepts `null` for
exactly this — it then shows no preview iframe. Return `null` from a resolver,
or set `fallback: null` to decline every unmapped document:

```ts
url: buildLivePreviewUrl({
  baseUrl: process.env.FRONTEND_URL,
  collections: {
    // No id yet means no stable route — no iframe beats a wrong one.
    services: ({ data }) => (typeof data.id === 'number' ? `/services/${data.id}` : null),
  },
  globals: { homepage: '/' },
  fallback: null, // anything unmapped resolves to no preview
}),
```

With string-only resolvers and a string `fallback` the callback keeps its
1.0 type and always produces a URL. Using `null` anywhere widens the return
type to `string | null`, so the two forms cannot be confused.

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

For rich text, the `<RichText />` component uses the same built-in Lexical serializer as live patches, reducing SSR/preview drift while providing the binding and empty-anchor pattern. Exact markup parity still requires equivalent sanitizer availability/configuration and the same custom node/block registrations in both JavaScript realms; server-side registrations are not copied into the prebuilt inline runtime:

```astro
---
import RichText from 'payload-live-preview/astro/RichText.astro';
---
<RichText value={page.body} field="body" class="prose" />
```

**Injection modes.** Three, and for a statically built site the default is rarely the best one.

`mode: 'inline'` (the default) bakes the runtime into every page at build time. Simple, and it works without a server — but every ordinary visitor downloads and parses ~21 KB gzip for a feature only an editor uses.

`mode: 'loader'` is the same deal without that cost. The page carries a few hundred bytes that check the preview context and fetch the runtime as a content-hashed, SRI-verified asset **only inside a preview**. Measured on the Astro fixture in this repository:

|                  | `index.html`    |
| ---------------- | --------------- |
| `mode: 'inline'` | 70 314 bytes    |
| `mode: 'loader'` | **3 151 bytes** |

That is per page, so a hundred-page site saves it a hundred times. The asset is published once at `/_payload-live-preview/runtime.<hash>.js`, cached across every page, and — because the configuration stays in the inline bootstrap — byte identical for every site on this version. It therefore cannot carry a deployment secret, and a redeploy that did not change the runtime does not invalidate the cached copy. `astro dev` serves the same path from memory, so development and production behave the same.

```ts
livePreview({
  mode: 'loader',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
}),
```

The trade is one extra request the first time an editor opens a preview.

Under a strict CSP, the asset itself is unremarkable: a same-origin script with an `integrity` attribute, needing no `'unsafe-inline'`. The bootstrap does need covering, though — a static build has no request, so there is no per-request nonce to attach and Astro emits it as a plain inline `<script>`. Its content is deterministic for a given package version and configuration, so the practical answer is a `'sha256-…'` source expression rather than `'unsafe-inline'`. `mode: 'middleware'` is the option that can carry a real nonce, because there a request exists to derive one from.

For SSR projects (`output: 'server'`), request-time injection can limit the bytes to requests carrying preview intent:

```ts
livePreview({
  mode: 'middleware',
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  serverURL: import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
}),
```

This auto-registers the preview middleware: it detects `?preview=true` / `?draft=true`, `Sec-Fetch-Dest: iframe`, or an admin referer, injects the script, and merges `frame-ancestors`. These are all client-controlled **intent signals**. Restricting to `previewSignals: ['query']` reduces accidental activation but still does not authenticate a user. `allowedOrigins` protects the browser's inbound `postMessage` channel; it does not authorize the HTTP request. `shouldInject` is only a route/content filter and does not suppress CSP handling.

If draft data or response changes are privileged, use one application-owned server authorization for all of them: draft selection, forwarded credentials, `private, no-store` cache policy, CSP changes, and runtime injection. The package deliberately does not infer that decision from intent. For example, invoke the manual Astro middleware only after your session verifier succeeds:

```ts
// src/middleware.ts
import { createLivePreviewMiddleware, isPreviewRequest } from 'payload-live-preview/astro';
import { verifyAppPreviewSession } from './lib/server/preview-auth'; // your server code

const previewMiddleware = createLivePreviewMiddleware({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
});

export const onRequest = async (context, next) => {
  const hasPreviewIntent = isPreviewRequest(context.request, {
    adminOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  });
  const authorization = hasPreviewIntent ? await verifyAppPreviewSession(context.request) : null;

  if (authorization === null) return next();

  // Reuse this request-scoped decision in the page's draft fetch.
  context.locals.previewAuthorization = authorization;
  const response = await previewMiddleware(context, next);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
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
// middleware.ts — frame-ancestors on requests carrying preview intent
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

A static build cannot make a request-time authorization decision, so the inline runtime bytes above are public and shipped to every page; `allowedOrigins` still constrains which browser messages are accepted. If runtime delivery or CSP changes must be private, use a dynamic preview route/layout and invoke both only after your server-side session or short-lived signed authorization succeeds. Never use a query/iframe/referer signal to unlock draft data.

### SvelteKit

```ts
// src/hooks.server.ts
import { livePreviewHandle } from 'payload-live-preview/sveltekit';
export const handle = livePreviewHandle({
  allowedOrigins: [process.env.PAYLOAD_ADMIN_ORIGIN!],
  serverURL: process.env.PAYLOAD_ADMIN_ORIGIN!,
});
```

This shorthand performs intent-gated delivery, not authentication. For protected preview responses, wrap it and invoke it only after an application-owned server verifier succeeds; reuse that authorization for draft data and cache policy.

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

The plugin hooks `render:html`, injects the script into responses carrying preview intent, and merges the CSP header. It does not authenticate those requests and exposes no authorization hook. If those response changes are protected, use an application-owned `render:html` hook and call `renderLivePreviewScript()` / `buildLivePreviewCsp()` only after the same authorization that controls draft data and caching.

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

Live preview patches the DOM **after** the page has loaded — the initial server render is your job. If you use Payload drafts, fetch draft content only after authorizing the preview request; otherwise editors see stale published content until their first keystroke. `fetchPreviewDocument` / `fetchPreviewGlobal` build the REST query but deliberately do not authenticate it. Their 1.x `draft` default remains `true` for compatibility, so set it explicitly from your verified decision:

```ts
// Astro example — in your page/loader code. The middleware example
// above stored this application-owned, request-scoped authorization.
import { fetchPreviewDocument } from 'payload-live-preview';

const authorization = Astro.locals.previewAuthorization ?? null;
const page = await fetchPreviewDocument<Page>({
  serverURL: import.meta.env.PAYLOAD_URL,
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  draft: authorization !== null, // published for unauthorised/normal traffic
  depth: 1, // keep equal to mergeDepth!
  ...(authorization === null ? {} : { headers: authorization.payloadHeaders }),
});
```

`isPreviewRequest()` is intentionally retained as the 1.x compatibility name, but it detects intent only. Query parameters, iframe navigation, and referrers are not credentials. Do not attach a long-lived API key or service token based on its boolean result; the verifier should forward only the minimum request-scoped session material or validate a short-lived, scoped signature.

## Data-attribute reference

| Attribute                      | Purpose                                                                                       | Example                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `data-payload-field`           | Bind element to a Payload field path                                                          | `data-payload-field="hero.title"`                  |
| `data-payload-type`            | Force a specific renderer                                                                     | `data-payload-type="image"`                        |
| `data-payload-attribute`       | Write the value into an attribute instead of content (unsafe attributes and URLs are refused) | `data-payload-attribute="datetime"`                |
| `data-payload-href`            | Read `href` from a sibling field                                                              | `data-payload-href="ctaUrl"`                       |
| `data-payload-src`             | Read `src` from a sibling field                                                               | `data-payload-src="hero.url"`                      |
| `data-payload-alt`             | Read `alt` from a sibling field                                                               | `data-payload-alt="hero.alt"`                      |
| `data-payload-richtext`        | Force Lexical rendering (usually auto-detected)                                               | `data-payload-richtext`                            |
| `data-payload-html`            | Render value as sanitised HTML                                                                | `data-payload-html`                                |
| `data-payload-array`           | Treat value as an array                                                                       | `data-payload-array`                               |
| `data-payload-array-template`  | HTML template per array item                                                                  | `data-payload-array-template="<li>{{title}}</li>"` |
| `data-payload-array-separator` | Separator for primitive arrays                                                                | `data-payload-array-separator=" · "`               |
| `data-payload-structural`      | Use diff-based structural updates                                                             | `data-payload-structural`                          |
| `data-payload-locale`          | Override locale for this element                                                              | `data-payload-locale="de-AT"`                      |
| `data-payload-owner`           | Document this subtree belongs to (see below)                                                  | `data-payload-owner="global:homepage"`             |

Binding metadata is live: changing any of these attributes (including inferred
type markers and an input's native `type`) rebuilds the affected cache snapshot
after the mutation debounce. Locale-specific bindings resolve their own suffixed
field value, and stale work prepared for a previous element locale is discarded.

**Empty-field gotcha:** the runtime can only patch elements that exist. If your template renders a binding only when the field is non-empty, editing a previously-empty field has nowhere to land. Render the anchor unconditionally:

```astro
<div data-payload-field="subtitle">{subtitle ?? ''}</div>
```

### Pages that preview more than one document

By default a binding's identity is its field path alone. On a page that renders
several documents — a page global, shared SEO metadata, and a list of collection
rows — a field called `title` in any of them matches every `title` on the page,
so editing one overwrites all of them.

`data-payload-owner` names the document a subtree belongs to. It is resolved
from the nearest marked ancestor (the element itself included), so a shell
component can own a whole region without repeating the marker, and a nested
document can override the owner it would inherit:

```astro
<section data-payload-owner="global:homepage">
  <h1 data-payload-field="title">{page.title}</h1>

  <article data-payload-owner={`collection:services:${service.id}`}>
    <h2 data-payload-field="title">{service.title}</h2>
  </article>
</section>
```

The grammar is `global:<slug>`, `collection:<slug>`, or
`collection:<slug>:<id>`. A marker without an id claims every document of that
collection, which is what a page rendering exactly one of them wants.

Enable enforcement with `scopeBindingsByOwner` — off by default so existing 1.x
pages keep working unchanged:

```ts
new LivePreviewClient({ allowedOrigins: [...], scopeBindingsByOwner: true });
```

Payload already sends the edited document's identity on every message, so
nothing else needs configuring. While enabled:

- an update reaches only bindings owned by the document it names;
- a binding **without** an owner is never updated — ownership is a deliberate
  claim, not a default that silently matches everything;
- an exact `collection:<slug>:<id>` marker stays unreachable while the message
  carries no document id, rather than being addressed on a guess;
- a message naming neither a global nor a collection changes nothing and warns
  once.

The same option exists on `generateInlineScript()` for the adapter path.

### Keeping binding attributes off public responses

Binding attributes are not neutral markup. `data-payload-field` names a CMS
field, and `data-payload-owner` names a global, a collection and often a
document id. Emitted unconditionally they publish the shape of your content
model — and the identity of documents — to every anonymous visitor and
crawler.

The gate is the same decision that already controls draft reads. Apply it once
per request with `createPreviewBindings()` so no individual call site can
forget it:

```ts
const preview = createPreviewBindings({
  authorized: authorization !== null, // your verified server-side decision
  owner: `global:${slug}`,
});
```

```astro
<section {...preview.owner()}>
  <h1 {...preview.bind<Homepage>('heroTitle')}>{data.heroTitle}</h1>
  <div {...preview.bind<Homepage>('intro', { richtext: true })} />
</section>
```

While unauthorized every helper returns an empty attribute set, so the response
carries no `data-payload-*` at all.

**Emit a binding as one unit.** A field travels with its type, locale,
rich-text marker and owner. Hand-writing a companion next to a gated field
leaves it behind when the gate closes — the taxonomy leaks anyway, and the
runtime sees a binding whose field is gone. Pass companions through
`BindOptions` (`richtext`, `html`, `locale`, `type`, `attribute`) instead of
writing the attributes yourself.

⚠️ **Do not key CSS off `data-payload-*`.** A selector like

```css
section:not(:has([data-payload-field]:not(:empty))) {
  display: none;
}
```

reads "no filled binding" as "empty section" the moment nobody is logged in,
so gating emission silently changes your **public** layout. Style on a stable
marker of your own that has nothing to do with preview state.

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
client.events.on('beforeUpdate', (e) => {
  if (frozen) e.cancel();
});
client.events.on('documentSave', () => location.reload());
```

Events: `init` · `connect` · `disconnect` · `beforeUpdate` · `afterUpdate` · `elementUpdate` · `documentSave` · `cacheRefresh` · `error` · `destroy`.

Plugin resources are registration-scoped. `client.unuse(name)` revokes that registration's event listeners, transforms, renderer layers, and `registerCleanup()` callbacks without touching another plugin or the built-in renderer; registering it again starts with a fresh scope. Resources remain staged until `init()` succeeds, and a failed `init()` rolls them back without exposing a partial registration. Renderers form a per-type stack (last active registration wins, removal reveals the previous layer). Synchronous transforms see the merged field value and run in registration order while each revision-bound binding entry is prepared, immediately before that entry is scheduled. The transformed value is fixed in the entry and later passes through the normal attribute or renderer dispatch. A thrown error or Promise/thenable result emits a lifecycle `error` and stores the original merged value as fallback, which still passes through the normal security checks.

Built-in plugins:

| Plugin                             | Effect                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `highlightPlugin`                  | Flashes an outline on updated elements (respects reduced-motion).                                |
| `debugPlugin`                      | Logs every lifecycle event to the console.                                                       |
| `createAnalyticsPlugin()`          | Collects update statistics, exposed via `getStats()`.                                            |
| `documentSavePlugin({ strategy })` | Reacts to admin saves: `'silent'` · `'reload'` (scroll-preserving) · `'revalidate'` · `'fetch'`. |

## Configuration reference

Options accepted by `generateInlineScript`, every adapter, and `LivePreviewClient`:

| Option           | Default                                                                 | Meaning                                                                                                 |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `allowedOrigins` | `[]`                                                                    | Allowed admin origins for inbound browser messages (recommended in production; not HTTP authorization). |
| `serverURL`      | —                                                                       | Payload origin for REST data merging (Payload 3.x population).                                          |
| `apiRoute`       | `/api`                                                                  | REST route prefix used with `serverURL`.                                                                |
| `mergeDepth`     | `1`                                                                     | Population depth used with `serverURL`.                                                                 |
| `debug`          | `false` for inline/adapters; dev-mode detection for `LivePreviewClient` | Verbose console logging.                                                                                |
| `debounceMs`     | `50`                                                                    | Debounce window for incoming updates.                                                                   |
| `heartbeatMs`    | `0` (off)                                                               | Idle timeout. Leave off — Payload sends no keepalive.                                                   |

Additional runtime options accepted by `generateInlineScript` and `LivePreviewClient`
(not by the adapter option objects):

| Option                     | Default   | Meaning                                                                                                                                                                                                                           |
| -------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enableA11y`               | `true`    | Shared `aria-live` region announcing connections, applied updates, and heartbeat-timeout disconnects while mounted; destroy releases it synchronously without promising a final audible announcement.                             |
| `disableVisibilityGate`    | `false`   | Apply updates to off-screen elements immediately.                                                                                                                                                                                 |
| `visibilityGateThreshold`  | `50`      | Cache size above which off-screen updates are queued.                                                                                                                                                                             |
| `scopeBindingsByOwner`     | `false`   | Restrict each update to bindings owned by the document it names (`data-payload-owner`). Unowned bindings stop updating.                                                                                                           |
| `skipUnchanged`            | `false`   | Skip a binding whose value is identical to the one it last applied, so a keystroke re-renders only what changed. Renderers and `elementUpdate` then stop seeing repeats; `inspect().revisions.skippedUnchanged` counts the skips. |
| `dependencies`             | `{}`      | Fields whose change re-applies other bindings even when their own value did not change: `{ price: ['priceLabel'] }`. Used only with `skipUnchanged`.                                                                              |
| `intersectionRootMargin`   | `'200px'` | Pre-render margin for the visibility gate.                                                                                                                                                                                        |
| `disableReferrerDetection` | `false`   | Opt out of `document.referrer` origin auto-detection.                                                                                                                                                                             |
| `disableLocalhostMatching` | `false`   | Opt out of dev-mode localhost origin matching.                                                                                                                                                                                    |

`LivePreviewClient` additionally accepts the programmatic-only `mergeFetch`,
`a11yLocale`, `root`, `autoStart`, and `validateToken` options. `validateToken` is a
package extension: an unmodified Payload admin does not send the required token.

Adapter options vary by framework. Shared adapter options include `inject`
(`'preview-only'` default / `'always'`), `previewQueryParams`, `previewSignals`
(choose which client-controlled intent signals count), `autoInject`, `manageCsp`
(`'frame-ancestors'` default / `'full'` / `false`), `strictDynamic`,
`frameAncestorsExtra`, and `scriptSrcExtra`. Astro, Next.js, and SvelteKit also expose
`shouldInject` as a script route/content filter only; it is not authorization and
does not suppress CSP handling. Astro additionally accepts `mode` (`'inline'` /
`'middleware'`). The Astro, Next.js, and Nuxt manual render helpers accept a
per-request `nonce`; `generateInlineScript()` itself returns a script body, so pass
the nonce to `wrapWithScriptTag()` when embedding it manually.

Bundle-size note: `import … from 'payload-live-preview/core'` is a lighter entry without the built-in plugin constructors, inline generator/runtime source, or framework adapters. It still includes the built-in field renderers used by `LivePreviewClient`, including Lexical rendering. Hot-path timings live in [docs/benchmarks.md](docs/benchmarks.md).

The four real-app browser fixtures in `examples/` cover Astro 7, Next.js 16, SvelteKit 2, and Nuxt 3 in Chromium, Firefox, and WebKit. The Astro 4–7 peer range is broader than the single Astro-major browser fixture.

**How the protocol coverage is layered** (so you know exactly what's proven):

1. **Full running-Payload E2E** (`tests/real-payload/`, `npm run test:e2e:real-payload`) boots an **actual Payload 3.x admin** — `examples/payload-backend`, a self-contained SQLite Payload + Next.js server, seeded and auto-logged-in — opens its **real** Live Preview panel, types into real form fields, and asserts the cross-origin Astro preview iframe (our injected runtime) patches the DOM. No mock, no fixture, no stub: `real admin → real form → real postMessage → real iframe → runtime → DOM`, driven by Payload's own admin code.
2. **Browser E2E** (`tests/e2e/`) drives a real browser + real iframe across Chromium, Firefox and WebKit: `postMessage → runtime → DOM`. Its `/admin` page _emulates_ the Payload admin, so it can exercise edge cases (XSS, origin spoofing, every field type) faster than booting a full server.
3. **Real-message contract test** (`tests/integration/real-payload-protocol.test.ts`) feeds a message **captured verbatim from a running Payload 3.85 admin** through the real `MessageBus` + runtime — the envelope quirks included: `collectionSlug` absent on a global, `externallyUpdatedRelationship: null`, `_status`/`id` alongside real fields.
4. **Weekly protocol-watch** (`.github/workflows/protocol-watch.yml`) **executes** the real `@payloadcms/live-preview@latest` **and `@canary`** (Payload 4.0 pre-releases) and asserts their actual behaviour — the `ready` handshake, event discriminators, and `mergeData` REST request — still matches our runtime's invariants.

Together these span the whole spectrum: tier 1 proves the real thing works end to end, tier 2 exhausts edge cases quickly, tier 3 pins the exact wire shape Payload emits, and tier 4 catches drift the moment Payload ships it.

## Security model

- **Preview intent is not authorization** — `isPreviewRequest()` checks client-controlled query, iframe-destination, and referer signals. `allowedOrigins` governs browser `postMessage` senders, and `shouldInject` is a route/content filter; neither authenticates the HTTP request. Verify an application-owned server session or short-lived scoped signature, then use that one result to control draft reads and credentials, `private, no-store` caching, CSP changes, and runtime injection.
- **Origin validation** — every incoming `postMessage` is checked against explicit `allowedOrigins` plus (in dev) a localhost pattern. `document.referrer` is a **zero-config fallback only**: the moment you configure explicit origins, the referrer is ignored — a foreign site framing your page can never widen a pinned allow-list. After the first accepted data-bearing update the detector locks to that exact origin. ⚠️ In referrer-fallback mode any site that frames the page becomes a trusted sender — the inline bootstrap logs a warning; set explicit `allowedOrigins` and serve a `frame-ancestors` CSP in production. Adapters add that policy by default on intent-matched responses; invoke them behind application authorization when the policy change is privileged.
- **HTML sanitisation** — Browser/live Lexical and HTML-field writes run through a DOM sanitiser with a curated tag/attribute whitelist (media tags allowed; `<script>`, `<form>`, `<iframe>`, `<svg>`, event handlers, `style` rejected; `srcset` candidates URL-validated). SSR `lexicalToHtml()` uses the same backstop when a DOM is supplied with `setSanitizerDocument()`; without one, built-in nodes remain escape-by-default but custom node/block renderers must sanitize their own HTML.
- **URL validation** — every URL that lands in `href`/`src`/`srcset`/`poster` must be `http(s)` / `mailto:` / `tel:` / relative; `javascript:`, `data:`, `vbscript:`, `file:`, `blob:` are rejected (case-insensitive, whitespace-tolerant). External links — including protocol-relative ones — get `rel="noopener noreferrer"`.
- **Binding attributes are disclosure** — `data-payload-field` names a CMS field and `data-payload-owner` names a document; emitting them unconditionally publishes your content model to anonymous visitors. `createPreviewBindings({ authorized })` applies one verified decision per request and suppresses the field together with every companion attribute, so no partial binding survives. Never key CSS off these attributes: gating them would then change public layout.
- **Policed attribute writes** — `data-payload-attribute` refuses event handlers, `style`, `srcdoc`, `formaction`, `id`/`name` (DOM clobbering) and validates URL attributes.
- **CSP-friendly** — adapters merge `frame-ancestors` for the admin origins without clobbering your existing policy; opt-in `manageCsp: 'full'` manages a per-request nonce'd `script-src` (`'strict-dynamic'` opt-in — it disables `'self'`/host sources in CSP 3).
- **No prototype pollution** — nested field lookups refuse `__proto__`, `prototype`, `constructor`; incoming data is never merged into existing objects.

Full details in [docs/security.md](docs/security.md). Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Inspecting a running preview

When a preview misbehaves, `inspect()` returns a point-in-time snapshot of what
the runtime actually sees. It performs no I/O and transmits nothing.

Adapter users reach it on the global handle inside the preview iframe — that is
the point, because there is no client object to call a method on:

```js
// In the browser console, inside the preview iframe
__livePreview.inspect();
```

Consumers driving the runtime themselves call it on the client:

```ts
const client = initLivePreview({ allowedOrigins: ['https://cms.example.com'] });
console.log(client.inspect());
```

The snapshot answers the questions that are otherwise guesswork:

| Reading                                                    | What it tells you                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bindings.orphanFields`                                    | Field names that arrived but matched no element. A name here is a markup problem; a name in neither this nor `bindings.fieldNames` was never sent.                                   |
| `scheduler.deferred` with `scheduler.visibilityGateActive` | Updates the visibility gate is holding until the element scrolls into view. On a page nobody scrolls, that is "never" — the symptom is a preview that stops updating below the fold. |
| `revisions.superseded`                                     | Updates abandoned because a newer one arrived. Tracking `accepted` closely is normal for fast typing; it only matters when the _last_ update is among them.                          |
| `origins.locked`                                           | The origin the runtime locked onto after its first accepted update. Every other origin is refused from then on.                                                                      |
| `bindings.ownerScoped` with `bindings.owners`              | Whether owner scoping is on, and which documents the page declares. Under scoping, an unowned binding receives nothing.                                                              |
| `protocol.negotiated`                                      | The version both sides share, which caps the capabilities in `protocol.capabilities`.                                                                                                |

This is deliberately not gated to development builds. A snapshot discloses
nothing that is not already on the page — the trusted origins are inside the
injected script and the field names are `data-payload-field` attributes in the
DOM — and a preview that misbehaves only on the deployed site is exactly the
case where the information is worth having.

## Auditing a deployment: `pll doctor`

`inspect()` answers "what is this runtime doing right now" from inside the page.
`pll doctor` answers the question one step earlier: **what is this deployment
actually serving?**

```
npx pll doctor https://example.com/some-page --admin https://cms.example.com
```

It fetches the URL twice — once as an ordinary visitor, once with the headers
the admin's iframe sends — and reports the difference. That comparison is the
point: a config can say `allowedOrigins: [...]` while a proxy strips the
header, an adapter runs in a mode nobody remembers choosing, or a build emits
binding attributes on public pages.

What it checks:

| Code     | Finding                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LP0701` | No inline runtime in the preview response. A warning, not an error: the audit cannot tell an adapter that missed the request from a consumer who starts `LivePreviewClient` themselves. Also reports, as information, when the runtime reaches anonymous visitors (correct for `inject: 'always'`). |
| `LP0702` | No `frame-ancestors` on the preview response, or a policy that does not admit `--admin`. A bare `'self'` counts as admitting it when admin and site share an origin.                                                                                                                                |
| `LP0703` | `X-Frame-Options` forbids framing — browsers honour it independently of CSP. `SAMEORIGIN` is accepted when `--admin` shares the page's origin; `DENY` never is.                                                                                                                                     |
| `LP0704` | Binding attributes served to anonymous visitors.                                                                                                                                                                                                                                                    |
| `LP0705` | More bindings than the default `visibilityGateThreshold` writes eagerly.                                                                                                                                                                                                                            |
| `LP0706` | Bindings outside every owner marker, which receive nothing under `scopeBindingsByOwner`.                                                                                                                                                                                                            |
| `LP0707` | The runtime is present with nothing to write into.                                                                                                                                                                                                                                                  |

Exit codes: `0` no error-level findings, `1` usage error or the URL could not be
fetched, `2` at least one error-level finding — so it drops into CI as a smoke
test against a deploy preview. `--json` emits the report as data.

The audit makes exactly the two requests it is told to make, sends no
credentials, and reports no telemetry. `analyzeProbe()` is exported from
`payload-live-preview/doctor` for callers who fetch the responses themselves.

## Diagnostic codes

Every message the runtime reports carries a stable code. Prose gets reworded; a
code does not — so a log filter, an alert rule, or a bug report that names
`LP0301` still means the same thing after the sentence around it changes.

| Code     | Meaning                                              | What to do                                                                                             |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `LP0101` | No trusted origin configured in production           | Set `PAYLOAD_ADMIN_ORIGIN` or pass `allowedOrigins`. Nothing is accepted until you do.                 |
| `LP0102` | Origin trust rests on `document.referrer`            | Any framing site is trusted. Set `allowedOrigins` and a `frame-ancestors` CSP.                         |
| `LP0201` | An update named a field with no binding on the page  | Render the binding anchor unconditionally so edits to an initially-empty field have somewhere to land. |
| `LP0202` | Owner scoping is on and the update names no document | The message carries neither a global slug nor a collection slug plus id.                               |
| `LP0301` | The visibility gate held offscreen writes back       | Raise `visibilityGateThreshold`, or accept that below-the-fold updates wait for a scroll.              |
| `LP0401` | A value was refused as an unsafe attribute write     | The attribute or the value is not safe to write; see the security model.                               |
| `LP0402` | A text element has structured children               | Move `data-payload-field` to the value element, or add `data-payload-text`.                            |
| `LP0403` | A structural container has no array template         | Add `data-payload-array-template`.                                                                     |
| `LP0501` | A message was rejected before the update pipeline    | Reason is one of origin, shape, type, token. Visible with `debug: true`.                               |
| `LP0502` | A preview token was rejected                         | Also reported when your `validateToken` throws — a throwing validator fails closed.                    |
| `LP0601` | A consumer event handler threw                       | Your `on(...)` handler; the runtime continued.                                                         |
| `LP0602` | A consumer transform threw                           | The original value was kept.                                                                           |
| `LP0603` | A renderer threw while writing                       | That one write was abandoned.                                                                          |
| `LP0605` | Runtime startup failed                               |                                                                                                        |
| `LP0606` | Sending the ready handshake failed                   |                                                                                                        |

Codes on the `error` event can be branched on directly:

```ts
import { DIAGNOSTIC_CODES } from 'payload-live-preview';

client.events.on('error', (e) => {
  if (e.code === DIAGNOSTIC_CODES.TransformThrew) reportToSentry(e.error);
});
```

Codes are never reused for a different meaning and never renumbered. `LP0604`
is reserved and unassigned.

## Troubleshooting

- **Nothing updates** — call `__livePreview.inspect()` in the preview iframe's console first; it names the cause in most cases (see [Inspecting a running preview](#inspecting-a-running-preview)). `debug: true` adds verbose diagnostics on top. The most common causes: the admin origin is not in `allowedOrigins`; the page is not actually loaded in an iframe; the binding element does not exist (see the empty-field gotcha above — orphan-update warnings are always enabled and deduplicated per field).
- **Relationship fields show IDs** — set `serverURL` (Payload 3.x sends unpopulated form values).
- **`Referrer-Policy: no-referrer`** on the admin breaks zero-config origin detection — set `allowedOrigins` explicitly.
- **Preview iframe refuses to load** — your host sets `X-Frame-Options` or a restrictive `frame-ancestors`. The adapters' CSP management overrides `frame-ancestors` on intent-matched responses, but `X-Frame-Options: DENY` from a proxy must be removed for authorized preview responses.

## License

MIT © relative23
