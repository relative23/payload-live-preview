# payload-live-preview

[![CI](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](package.json)
[![Payload 2.x / 3.x](https://img.shields.io/badge/Payload-2.x%20%2F%203.x-black)](https://payloadcms.com)
[![npm](https://img.shields.io/npm/v/payload-live-preview?color=cb3837&logo=npm)](https://www.npmjs.com/package/payload-live-preview)

> **Live preview for Payload CMS in Astro** — and any other server-rendered or static frontend (SvelteKit, Nuxt, Next.js, plain HTML).

**The missing piece for Astro + Payload.** The official live-preview packages are React and Vue hooks: they re-render a hydrated component tree, so they cannot touch server-produced Astro markup. This package makes the admin's real-time preview work where no client framework owns the page. Annotate your markup with `data-payload-field`, add one line to `astro.config.mjs`, and edits stream into the preview iframe as the editor types. No rebuild, no reload, no React.

The runtime is framework-agnostic: one script drives Astro, SvelteKit, Nuxt, Next.js and plain HTML. Astro is the first-class, end-to-end-tested path.

**New here? Start with the [Astro guide](docs/astro.md), or pick your framework in the [documentation index](docs/README.md).**

## Highlights

- **One runtime, every frontend.** One TypeScript runtime compiled to a self-contained inline script of about 29 KB gzip; the adapters for Astro, Next.js, SvelteKit and Nuxt only decide when to deliver it.
- **Payload 3.x native.** `serverURL` re-fetches the populated document after every edit, like the official client, so relationship and upload fields render as content rather than as IDs.
- **Complete Lexical renderer.** 16 node types including `upload`, `relationship`, `block`, `autolink`, tabs, indent and RTL, with automatic rich-text detection: `data-payload-field` alone is enough.
- **Authorization before anything privileged.** Draft reads, runtime injection, CSP changes and binding attributes follow one verified decision per request; the client-controlled intent signals never unlock anything.
- **Strict by default.** Escape-by-default sanitizer, URL and `srcset` validation, policed attribute writes, prototype-pollution guards, per-instance clients, typed bindings with `pll-codegen`.

## Compatibility

|                                                | Payload 2.x                   | Payload 3.x                                                           |
| ---------------------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| Scalar field updates                           | ✅                            | ✅                                                                    |
| Rich text (Lexical)                            | ✅                            | ✅                                                                    |
| Relationship / upload population               | ✅ (admin merges client-side) | ✅ with `serverURL` (REST merge)                                      |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅                            | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) |

<!-- compat-matrix:start -->

| Framework | Supported             | Tested in CI on every push (version, browsers)                                    |
| --------- | --------------------- | --------------------------------------------------------------------------------- |
| Astro     | >=4.0.0 <8.0.0        | 7.2.1 (chromium, firefox, webkit); 6.x (chromium); 5.x (chromium); 4.x (chromium) |
| Next.js   | App Router, 15 and 16 | 16.3.0 (chromium, firefox, webkit)                                                |
| SvelteKit | 2.x                   | 2.70.2 (chromium, firefox, webkit)                                                |
| Nuxt      | 3.x                   | 3.21.11 (chromium, firefox, webkit)                                               |

Node >=20.19.0; the unit and integration suites run on Node 20, 22, 24, 26. Every version in the table is what the fixture lockfile or the matrix job installs, checked by `npm run compat:check`.

- Payload 2.x: captured-message integration tests and fieldSchemaJSON typing.
- Payload 3.85.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.88.0: real admin E2E (examples/payload-backend) on every push, plus a wire corpus captured from it.
- Payload latest: weekly protocol watch executes @payloadcms/live-preview@latest against the corpus.
- Payload 4.0 pre-releases: weekly protocol watch against @payloadcms/live-preview@canary, early warning only.

<!-- compat-matrix:end -->

**When to use the official packages instead.** A client-rendered React or Vue app is better served by [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) / `-vue`: they re-render your real component tree and ship in lockstep with Payload. This package covers everything those hooks cannot: Astro, static and server-rendered pages, SvelteKit and Nuxt markup, plain HTML. What is shared, what is not, and running both on one page: [docs/interop.md](docs/interop.md).

## Install

```bash
npm install payload-live-preview
```

Three entries cover most projects. The root `payload-live-preview` carries the client, the inline script generator, the renderers and the plugins. `payload-live-preview/astro`, `/nextjs`, `/sveltekit` and `/nuxt` hold one framework adapter each. `payload-live-preview/server` is the privileged surface for server code: `definePreview()`, `authorizePreviewRequest()`, `issuePreviewToken()` and `createPreviewBindings()`. The focused entries (`core`, `client`, `lexical`, `structural`, `plugins`, `fragment`, `payload`, `codegen`, `doctor`, `migrate`) are listed in [docs/options.md](docs/options.md).

## Configure Payload

Enable live preview in `payload.config.ts`. The `url` callback maps the edited document to the frontend URL shown in the preview iframe; `buildLivePreviewUrl` replaces the usual lookup-table boilerplate:

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

The helper appends `?preview=true`, one of the query parameters (`preview`, `draft`, `livePreview`) the adapters read as preview intent. The parameter is client-controlled: it selects delivery and never authorizes draft access. A hand-written `url: ({ data, locale, collectionConfig, globalConfig }) => string` callback works the same way; the [official docs](https://payloadcms.com/docs/live-preview/overview) have the full contract. A resolver may return `null` for a document without a route, and `fallback: null` declines every unmapped one; Payload then shows no iframe.

To verify the iframe request without a session cookie crossing origins, mint a short-lived token inside the `url` callback with `issuePreviewToken()` and check it in the adapter with the `signed-token` strategy. [docs/authorization.md](docs/authorization.md) shows both sides, the `payload-session` and `verifier` strategies, and the initial draft read.

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
      // Required alongside serverURL: the population depth, 0 for none.
      mergeDepth: 1,
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

That is it: the inline script detects the admin's iframe and starts patching. Rich text is detected from the value shape; `data-payload-richtext` only forces it. Payload 3.x posts raw form values, so relationship and upload fields arrive as IDs until `serverURL` with `mergeDepth` re-fetches the populated document ([docs/options.md](docs/options.md)). Injection modes, request-time middleware, authorization and the initial draft read: [docs/astro.md](docs/astro.md).

### Other frameworks

- **Next.js (App Router)** — the script in `app/layout.tsx`, the adapter middleware for headers: [docs/nextjs.md](docs/nextjs.md).
- **SvelteKit** — `livePreviewHandle()` in `hooks.server.ts`: [docs/sveltekit.md](docs/sveltekit.md).
- **Nuxt** — a Nitro plugin plus a server handler: [docs/nuxt.md](docs/nuxt.md).
- **Plain HTML** — `generateInlineScript()` at build time: [docs/html.md](docs/html.md).

## Patch, fragment, route

A binding is patched in place by default. A `data-payload-fragment` boundary is rendered by your server from the unsaved form state instead — conditional sections, derived values, custom blocks, the component's own logic — and morphed in with focus and visitor state intact; the runtime posts the fields to a same-origin endpoint built with `createFragmentEndpoint()` and patches the boundary's own bindings when the server cannot render. A binding in `<head>`, or one marked `data-payload-strategy="route"`, refreshes the whole route once per revision with scroll and focus kept. Markup, endpoint, deployment requirements and the abuse model: [docs/hybrid.md](docs/hybrid.md).

## Events and plugins

```ts
const client = new LivePreviewClient({ allowedOrigins: [ADMIN] });

client.events.on('connect', (e) => console.log('connected to', e.origin));
client.events.on('beforeUpdate', (e) => {
  if (frozen) e.cancel();
});
client.events.on('documentSave', () => location.reload());
```

Every event, transforms, custom field renderers, the built-in plugins and the plugin ownership contract: [docs/renderers.md](docs/renderers.md).

## Security model

- **Preview intent is not authorization.** The query parameter, the iframe destination and the referer are client-controlled; the adapters count the query alone by default. `allowedOrigins` governs browser `postMessage` senders and `shouldInject` filters routes; neither authenticates the request. `authorizePreviewRequest()` does, and that one result controls draft reads, `private, no-store` caching, CSP changes and runtime injection.
- **Origin validation.** Every incoming message is checked against `allowedOrigins`; `document.referrer` is ignored by default, and after the first accepted update the runtime locks to that origin. The adapters merge a `frame-ancestors` policy for the admin origins without clobbering the rest of your CSP.
- **Sanitization and URL validation.** Lexical and HTML writes pass a DOM sanitizer with a curated allow-list — `<script>`, `<form>`, `<iframe>`, `<svg>`, event handlers and `style` are rejected — and every `href`, `src`, `srcset` and `poster` must be `http(s)`, `mailto:`, `tel:` or relative; external links get `rel="noopener noreferrer"`.
- **Binding attributes are disclosure.** `data-payload-field` names a CMS field and `data-payload-owner` a document. `createPreviewBindings({ authorization })` suppresses them, companions included, on public responses. Never key CSS off `data-payload-*`.
- **Policed writes, no prototype pollution.** `data-payload-attribute` refuses event handlers, `style`, `srcdoc`, `formaction`, `id` and `name`; nested lookups refuse `__proto__`, `prototype` and `constructor`, and incoming data is never merged into existing objects.

Full details in [docs/security.md](docs/security.md). Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Troubleshooting

- **Nothing updates.** Run `__livePreview.inspect()` in the preview iframe's console first; it names the cause in most cases. The common ones: the admin origin is missing from `allowedOrigins`, the page is not inside an iframe, the bound element does not exist (an empty field needs an anchor).
- **Relationship fields show IDs.** Set `serverURL` with `mergeDepth`; Payload 3.x posts unpopulated form values.
- **The preview iframe refuses to load.** The host sets `X-Frame-Options` or a restrictive `frame-ancestors`. The adapters merge `frame-ancestors` on authorized preview responses; an `X-Frame-Options: DENY` from a proxy must go.
- **The adapter refuses to start.** The strict default needs `authorizePreview`, a non-empty `allowedOrigins` (`https:` in production) and no referer trust; `defaults: 'v1'` stages a migration one row at a time.

`inspect()` readings, `pll doctor` and every diagnostic code: [docs/troubleshooting.md](docs/troubleshooting.md).

## Documentation

The reading path, with a glossary: [docs/README.md](docs/README.md).

- Framework guides: [Astro](docs/astro.md) · [Next.js](docs/nextjs.md) · [SvelteKit](docs/sveltekit.md) · [Nuxt](docs/nuxt.md) · [Plain HTML](docs/html.md)
- [docs/bindings.md](docs/bindings.md) — data attributes, field types, owners, typed bindings and codegen
- [docs/options.md](docs/options.md) — package entries, every option and its default, Payload 3.x population
- [docs/authorization.md](docs/authorization.md) — strategies, signed tokens, the initial draft read
- [docs/hybrid.md](docs/hybrid.md) — patch, fragment and route
- [docs/renderers.md](docs/renderers.md) — events, transforms, renderers and plugins
- [docs/deployment.md](docs/deployment.md) — CSP, caches, proxies
- [docs/troubleshooting.md](docs/troubleshooting.md) — `inspect()`, `pll doctor`, diagnostic codes
- [docs/security.md](docs/security.md) · [docs/migration.md](docs/migration.md) · [docs/interop.md](docs/interop.md) · [docs/reveal.md](docs/reveal.md)
- Maintainers: [docs/testing.md](docs/testing.md), [docs/benchmarks.md](docs/benchmarks.md), [architecture decisions](docs/architecture/README.md), [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT © relative23
