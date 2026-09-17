# payload-live-preview

[![CI](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](package.json)
[![Payload 2.x / 3.x](https://img.shields.io/badge/Payload-2.x%20%2F%203.x-black)](https://payloadcms.com)
[![npm](https://img.shields.io/npm/v/payload-live-preview?color=cb3837&logo=npm)](https://www.npmjs.com/package/payload-live-preview)

> **Live preview for Payload CMS on server-rendered and static sites** — Astro, Next.js, SvelteKit, Nuxt and plain HTML.

The official live-preview packages are React and Vue hooks: they re-render a hydrated component tree, so they cannot touch markup a server produced. This package makes the admin's real-time preview work where no client framework owns the page. Mark what should update — one attribute per component on a server-rendered page with a fragment endpoint, per field on a static one — and edits reach the preview iframe as the editor types: bound elements are patched in place, fragment boundaries are rendered again by your server. No rebuild, no reload. A client-rendered app gets React and Vue hooks with the same merge underneath. Strict by default, zero runtime dependencies.

One runtime serves every framework, and every framework adapter's example app runs end to end in Chromium, Firefox and WebKit on every push to `main` and on pull requests. Astro has the most coverage: the widest version matrix (4.x to 7.x), the only end-to-end tests against a real Payload admin, the `RichText` and `PreviewBoundary` components, and the build-time annotator.

**New here? Start with the [Astro guide](docs/astro.md), or pick your framework in the [documentation index](docs/README.md).**

## Highlights

- **One runtime, every frontend.** One TypeScript runtime compiled to a self-contained inline script of about 35 KB gzip — 28 KB with the lean artifact ([docs/options.md](docs/options.md)). The adapters for Astro, Next.js, SvelteKit and Nuxt deliver it; where they decide per request they also authorize the request, merge `frame-ancestors` into your CSP and mark the changed response `private, no-store`. They provide the fragment endpoint and, outside Astro, the route that serves the runtime asset.
- **Patch, fragment, route.** A binding is patched in place; a `data-payload-fragment` boundary is rendered again by your server from the unsaved form state; a binding in `<head>`, or one marked `data-payload-strategy="route"`, can refresh the whole route. A patch the runtime knows fell short, or a change nothing binds, is handed to the fragment render or a route refresh when the page has one ([below](#patch-fragment-route)).
- **Delivery.** Inline, or a bootstrap that fetches the content-hashed, SRI-verified runtime only inside a preview (`delivery: 'asset'`; Astro's static equivalent is `mode: 'loader'`). Where something decides per request — Astro's middleware, `<LivePreviewScript />` in Next.js, the SvelteKit handle, the Nuxt Nitro plugin — a public visitor receives no script at all ([docs/deployment.md](docs/deployment.md#what-a-public-visitor-pays)).
- **Payload 3.x native.** `serverURL` re-fetches the populated document, like the official client, so relationship and upload fields render as content rather than as IDs — but only when an edit needs one: in the DOM runtime, typing into a text field costs no request, and a burst on a relationship costs two rather than one per keystroke.
- **Lexical renderer.** 20 node types including `upload`, `relationship`, `block`, `autolink`, tabs, indent and RTL, with automatic rich-text detection: `data-payload-field` alone is enough. An unknown node renders only its children; a block with no registered renderer becomes an empty placeholder, and the live write keeps the markup your server rendered in its place when the two trees line up. The prebuilt inline runtime cannot register block renderers.
- **Hooks for client-rendered apps.** `useLivePreviewDocument()` from `payload-live-preview/react` or `/vue` hands the merged document to your component tree ([docs/react.md](docs/react.md), [docs/vue.md](docs/vue.md)).
- **Tooling.** `pll doctor <url>` requests a page as a visitor and as the admin's iframe and reports the difference; `pll migrate` rewrites 1.x APIs to their 2.0 names; `pll-codegen` generates types from the Payload config, and `pll-codegen annotate` finds the bindings a template can take unambiguously.
- **Authorization before anything privileged.** Where an adapter decides per request with `authorizePreview`, draft reads, runtime injection, CSP changes and binding attributes follow one verified decision, and the client-controlled intent signals unlock nothing. The setups that deliver at build time, render the script for every request or inject on intent alone are named under [Security model](#security-model).
- **Strict by default.** Escape-by-default sanitizer, URL and `srcset` validation, policed attribute writes, prototype-pollution guards, per-instance clients, typed bindings with `pll-codegen`.

## Compatibility

|                                                | Payload 2.x                                                                     | Payload 3.x                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Scalar field updates                           | ✅                                                                              | ✅                                                                    |
| Rich text (Lexical)                            | ✅                                                                              | ✅                                                                    |
| Relationship / upload population               | The admin's populated data, used as sent; not verified against a real 2.x admin | ✅ with `serverURL` (REST merge)                                      |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅                                                                              | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) |

<!-- compat-matrix:start -->

| Framework | Supported      | Tested in CI on every push (version, browsers)                                    |
| --------- | -------------- | --------------------------------------------------------------------------------- |
| Astro     | >=4.0.0 <8.0.0 | 7.3.2 (chromium, firefox, webkit); 6.x (chromium); 5.x (chromium); 4.x (chromium) |
| Next.js   | App Router, 16 | 16.3.4 (chromium, firefox, webkit)                                                |
| SvelteKit | 2.x            | 2.70.2 (chromium, firefox, webkit)                                                |
| Nuxt      | 3.x            | 3.21.11 (chromium, firefox, webkit)                                               |

Node >=20.19.0; the unit and integration suites run on Node 20, 22, 24, 26. Every version in the table is what the fixture lockfile or the matrix job installs, checked by `npm run compat:check`.

Vite 5 through 8: that is what the supported framework majors install (Astro 7 → 8, Astro 6 → 7, Astro 5 → 6, Astro 4 → 5, SvelteKit 2 → 5/6/7/8, Nuxt 3 → 7), measured 2026-09-06. `npm run compat:check` keeps the devDependency and the fixture lockfiles inside that span; `npm run compat:refresh` re-reads it from the registry.

- Payload 2.32.3: wire corpus captured from a real admin in a one-off round (examples/ has no Payload 2 fixture), replayed in tests/integration/wire-corpus.test.ts, plus fieldSchemaJSON typing in tests/integration/schema-driven.test.ts; relationship and upload population is not verified against a real 2.x admin.
- Payload 3.85.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.88.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.89.0: real admin E2E (examples/payload-backend) on every push, plus a wire corpus captured from it.
- Payload 4.0.0-canary.33: wire corpus captured from a real Payload 4 admin in a one-off upgrade round, replayed in tests/integration/wire-corpus.test.ts; the fixture itself stays on 3.x.
- Payload latest: daily protocol watch executes @payloadcms/live-preview@latest against the corpus.
- Payload 4.0 pre-releases: daily protocol watch against @payloadcms/live-preview@canary, early warning only.

<!-- compat-matrix:end -->

**A client-rendered app wants a hook.** `payload-live-preview/react` and `payload-live-preview/vue` are ones: `useLivePreviewDocument()` returns the merged document and re-renders your tree, with this package's merge underneath: every accepted update, a text edit too, sends one merge request, and a newer one aborts the request in flight; an HTTP error is refused instead of becoming the document; and each hook has a session of its own, so two previews on one page keep their own documents ([docs/react.md](docs/react.md), [docs/vue.md](docs/vue.md)). The official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) / `-vue` hooks ship in lockstep with Payload and remain the safe default if that matters more to you; running either alongside the DOM runtime on one page: [docs/interop.md](docs/interop.md).

## Install

```bash
npm install payload-live-preview
```

Three entries cover most projects. The root `payload-live-preview` carries the client, the inline script generator, the renderers and four of the five built-in plugins; the unbound-fields overlay and `PluginManager` are on `payload-live-preview/plugins`. `payload-live-preview/astro`, `/nextjs`, `/sveltekit` and `/nuxt` hold one framework adapter each; `/nuxt-module` registers the Nuxt one from `nuxt.config.ts`, and since it cannot carry `authorizePreview` it runs with `defaults: 'v1'` ([docs/nuxt.md](docs/nuxt.md)). `payload-live-preview/server` is the privileged surface for server code: `definePreview()`, `authorizePreviewRequest()`, `issuePreviewToken()` and `createPreviewBindings()`. The focused entries (`core`, `client`, `lexical`, `structural`, `plugins`, `fragment`, `lean`, `payload`, `codegen`, `codegen/astro`, `annotate`, `doctor`, `migrate`) are listed in [docs/options.md](docs/options.md).

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
        fallback: '/', // unmapped documents, and resolvers that return '', land here
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
      // process.env: import.meta.env carries no PUBLIC_ variables in this file.
      allowedOrigins: [process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
      // Payload 3.x: populate relationship/upload fields via REST merge
      serverURL: process.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN,
      // Required alongside serverURL: the population depth, 0 for none.
      mergeDepth: 1,
    }),
  ],
});
```

Then mark what should update. On a server-rendered page that is one attribute per component — the region is rendered again from the unsaved form state, so everything in it stays correct, conditional sections and derived values included:

```astro
<section data-payload-fragment="hero" data-payload-depends="title,subtitle,body">
  <Hero {...page} />
</section>
```

The attribute needs a renderer behind it: a route exporting `createFragmentEndpoint()` with `authorizePreview` or `authorize`, served at request time (an SSR adapter, `prerender = false` on that route), and its path in the options above as `fragments: { endpoint: '/payload/fragment' }` ([docs/hybrid.md](docs/hybrid.md)). Without `fragments` the bindings inside the boundary are patched instead (`LP0806`), and a boundary with none inside does not update.

On a static build there is no server to render it, so the fields are bound individually — and inside a boundary too, for the ones an editor types into while watching, because a patch keeps focus and the caret where a re-render would not:

```astro
<h1 data-payload-field="title">{title}</h1>
<div data-payload-field="body">…server-rendered rich text…</div>
<img data-payload-field="hero" alt={alt} src={url} />
```

Which to reach for, and what each costs: [docs/bindings.md](docs/bindings.md#how-much-markup-this-actually-needs). `pll-codegen annotate` adds the unambiguous bindings and names each one it refuses, with the reason; without `--write` it only reports, and exits with `3` when it found work.

That is it: the inline script detects the admin's iframe and starts patching. Rich text is detected from the value shape; `data-payload-richtext` only forces it. Payload 3.x posts raw form values, so relationship and upload fields arrive as IDs until `serverURL` with `mergeDepth` re-fetches the populated document ([docs/options.md](docs/options.md)). Injection modes, request-time middleware, authorization and the initial draft read: [docs/astro.md](docs/astro.md).

### Other frameworks

- **Next.js (App Router)** — `<LivePreviewScript />` in `app/layout.tsx`, the adapter middleware for headers: [docs/nextjs.md](docs/nextjs.md).
- **SvelteKit** — `livePreviewHandle()` in `hooks.server.ts`: [docs/sveltekit.md](docs/sveltekit.md).
- **Nuxt** — a Nitro plugin plus a server handler: [docs/nuxt.md](docs/nuxt.md).
- **Plain HTML** — `generateInlineScript()` at build time: [docs/html.md](docs/html.md).

## Patch, fragment, route

A binding is patched in place by default. A `data-payload-fragment` boundary is rendered by your server from the unsaved form state instead — conditional sections, derived values, custom blocks, the component's own logic — and morphed in with focus and visitor state intact; the runtime posts the fields to the same-origin endpoint named in `fragments: { endpoint }`, built with `createFragmentEndpoint()`, which every adapter entry exports — Astro renders through its container API, Next.js through `react-dom/server`, SvelteKit through `svelte/server`, Nuxt through `vue/server-renderer` — and patches the boundary's own bindings when the server cannot render. With `routeStrategy: true` or `fragments` set, a binding in `<head>`, or one marked `data-payload-strategy="route"`, refreshes the whole route once per revision with scroll and focus kept; without either it is patched like any other. The route is matched by top-level field name, so a dotted binding such as `meta.title` refreshes it only with `data-payload-depends="meta"`. Markup, endpoint, deployment requirements and the abuse model: [docs/hybrid.md](docs/hybrid.md).

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

- **Preview intent is not authorization.** The query parameter, the iframe destination and the referer are client-controlled; the adapters count the query alone by default. `allowedOrigins` governs browser `postMessage` senders and `shouldInject` filters routes; neither authenticates the request. `authorizePreviewRequest()` does, and where an adapter decides per request with `authorizePreview` — `createLivePreviewMiddleware()`, `livePreviewHandle()`, `livePreviewNitroPlugin()`, `defineLivePreviewServerHandler()` — that one result controls draft reads, `private, no-store` caching, CSP changes and runtime injection, and `<LivePreviewScript />` gates the Next.js script on the same verdict. Other setups decide less. Astro's build-time `inline` and `loader` modes and the synchronous `livePreviewScriptProps()` and `renderLivePreviewScript()` put the runtime or its bootstrap into every page that renders them, where it does not start outside a preview frame. Astro's `mode: 'middleware'` and the Nuxt module cannot carry `authorizePreview`, so they need `defaults: 'v1'` (or `strict: false`) and inject on intent alone.
- **Origin validation.** Every incoming message is checked against `allowedOrigins`; `document.referrer` is ignored by default, and after the first accepted update the inline runtime and `LivePreviewClient` lock to that origin (the React and Vue hooks do not). The adapters merge a `frame-ancestors` policy for the admin origins without clobbering the rest of your CSP.
- **Sanitization and URL validation.** Lexical and HTML writes pass a DOM sanitizer with a curated allow-list — `<script>`, `<form>`, `<iframe>`, `<svg>`, event handlers and `style` are rejected — and every `href`, `src`, `srcset` and `poster` must be `http(s)`, `mailto:`, `tel:` or relative; external links get `rel="noopener noreferrer"`.
- **Binding attributes are disclosure.** `data-payload-field` names a CMS field and `data-payload-owner` a document. `createPreviewBindings({ authorization })` suppresses them, companions included, on public responses. Never key CSS off `data-payload-*`.
- **Policed writes, no prototype pollution.** `data-payload-attribute` refuses event handlers, `style`, `srcdoc`, `formaction`, `id` and `name`; nested lookups refuse `__proto__`, `prototype` and `constructor`, and incoming data is never merged into existing objects.

Full details in [docs/security.md](docs/security.md). Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Troubleshooting

- **Nothing updates.** Run `__livePreview.inspect()` in the preview iframe's console first — the handle exists once the injected runtime has started inside a preview frame; a page that starts `LivePreviewClient` itself calls `client.inspect()`. It names the cause in most cases. The common ones: the admin origin is missing from `allowedOrigins`, the page is not inside an iframe, the bound element does not exist (an empty field needs an anchor).
- **Relationship fields show IDs.** Set `serverURL` with `mergeDepth`; Payload 3.x posts unpopulated form values.
- **The preview iframe refuses to load.** The host sets `X-Frame-Options` or a restrictive `frame-ancestors`. The adapters merge `frame-ancestors` on authorized preview responses; an `X-Frame-Options: DENY` from a proxy must go.
- **The adapter refuses to start.** The strict default needs `authorizePreview`, a non-empty `allowedOrigins` (`https:` in production) and no referer trust; `defaults: 'v1'` stages a migration one row at a time.

`inspect()` readings, `pll doctor` and every diagnostic code: [docs/troubleshooting.md](docs/troubleshooting.md). `pll doctor` sends its preview request with `?preview=true`; a preview behind `authorizePreview` is audited with an editor's credential. A signed token goes in the URL as `?previewToken=…`, which the visitor request drops; `--header "x-preview-token: …"` works only where the token strategy sets `transport: { kind: 'header' }`; a Payload session is `--header "Cookie: payload-token=…"`.

## Documentation

The reading path, with a glossary: [docs/README.md](docs/README.md).

- Framework guides: [Astro](docs/astro.md) · [Next.js](docs/nextjs.md) · [SvelteKit](docs/sveltekit.md) · [Nuxt](docs/nuxt.md) · [Plain HTML](docs/html.md) · [React hook](docs/react.md) · [Vue composable](docs/vue.md)
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
