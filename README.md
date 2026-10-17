# payload-live-preview

[![CI](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node >= 20.19](https://img.shields.io/badge/node-%3E%3D20.19-brightgreen)](package.json)
[![Payload 2.x / 3.x](https://img.shields.io/badge/Payload-2.x%20%2F%203.x-black)](https://payloadcms.com)
[![npm](https://img.shields.io/npm/v/payload-live-preview?color=cb3837&logo=npm)](https://www.npmjs.com/package/payload-live-preview)

![The Payload admin posts every keystroke; the runtime in the preview iframe patches the bound element in place, has your server render a fragment boundary, or refreshes the route](.github/social-preview.png)

> **Live preview for Payload CMS on server-rendered and static sites** — Astro, Next.js, SvelteKit, Nuxt and plain HTML.

Payload publishes the framework-independent `@payloadcms/live-preview` client and the official `@payloadcms/live-preview-react` and `@payloadcms/live-preview-vue` wrappers. Those hooks feed a hydrated component tree; they do not own server markup outside that tree. This package covers that markup. Mark one boundary per server-rendered component, or individual fields on a static page, and edits reach the iframe as the editor types. Scalar patches and successful fragment renders need neither a rebuild nor a full-page reload; a route-level change uses the configured route refresh. Client-rendered apps can instead use this package's React or Vue entry. Its v2 sanitizer and request-time policy defaults are strict; static delivery has no request to authorize. The package has no direct dependencies; framework entries use optional peers.

One runtime serves every framework, and every framework adapter's example app runs end to end in Chromium, Firefox and WebKit on every push to `main` and on pull requests. Astro has the most coverage: the widest version matrix (4.x to 7.x), the `RichText` and `PreviewBoundary` components, and the annotator as a Vite plugin (`pll-codegen annotate` itself also reads `.jsx`, `.tsx` and `.svelte`).

**New here? Start with the [Astro guide](docs/astro.md), or pick your framework in the [documentation index](docs/README.md).**

## Highlights

- **One runtime, every frontend.** One TypeScript runtime compiled to a self-contained inline script of about 44 KB gzip — 36 KB with the lean artifact, 47 to 49 KB once the route or fragment prelude is appended ([docs/options.md](docs/options.md)). The adapters for Astro, Next.js, SvelteKit and Nuxt deliver it; where they decide per request they also authorize the request, merge `frame-ancestors` into your CSP and mark the changed response `private, no-store`. They provide the fragment endpoint and, outside Astro, the route that serves the runtime asset.
- **Patch, fragment, route.** A binding is patched in place; a `data-payload-fragment` boundary is rendered again by your server from the unsaved form state; a patch that fell short, or a change nothing binds, goes to the fragment render or a route refresh when the page has one ([below](#patch-fragment-route)).
- **Delivery.** Inline, or a bootstrap that fetches the content-hashed, SRI-verified runtime only inside a preview (`delivery: 'asset'`; Astro's static equivalent is `mode: 'loader'`). Where something decides per request — Astro's middleware, `<LivePreviewScript />` in Next.js, the SvelteKit handle, the Nuxt Nitro plugin — a public visitor receives no script at all ([docs/deployment.md](docs/deployment.md#what-a-public-visitor-pays)).
- **Payload 3.x native.** `serverURL` re-fetches the populated document, like the official client, so relationship and upload fields render as content rather than as IDs — but only when an edit needs one: in the DOM runtime, typing into a text field costs no request, and a burst on a relationship costs two requests, at its start and its end, rather than one per keystroke.
- **Lexical renderer.** 20 node types including `upload`, `relationship`, `block`, `autolink`, tabs, indent and RTL, with automatic rich-text detection: `data-payload-field` alone is enough. An unknown node renders only its children; a block with no registered renderer becomes an empty placeholder, and the live write keeps the markup your server rendered in its place when the two trees line up. The prebuilt inline runtime cannot register block renderers.
- **Hooks for client-rendered apps.** `useLivePreviewDocument()` from `payload-live-preview/react` or `/vue` hands the merged document to your component tree ([docs/react.md](docs/react.md), [docs/vue.md](docs/vue.md)).
- **Tooling.** `pll doctor <url>` requests a page as a visitor and as the admin's iframe and reports the difference; `pll migrate` rewrites 1.x APIs to their 2.0 names; `pll-codegen` generates types from the Payload config, and `pll-codegen annotate` finds the bindings a template can take unambiguously.
- **Authorization before anything privileged.** Where an adapter decides per request with `authorizePreview`, draft reads, runtime injection, CSP changes and binding attributes follow one verified decision, and the client-controlled intent signals unlock nothing. The setups that decide less are named under [Security model](#security-model).
- **Strict by default.** Escape-by-default sanitizer, URL and `srcset` validation, policed attribute writes, prototype-pollution guards, per-instance clients, typed bindings with `pll-codegen`.
- **Also in the box.** `revealEditedField` scrolls the field being typed in into view ([docs/reveal.md](docs/reveal.md)); a hydrated island keeps its subtree and re-renders itself from a `payload-live-preview:update` event ([docs/hybrid.md](docs/hybrid.md#islands-on-the-same-page)); `data-payload-owner` scopes bindings on a page that previews several documents, `PreviewBoundary` keeps an anchor for a field that is still empty, and `autoBind: 'unique'` finds bindings by value ([docs/bindings.md](docs/bindings.md)); array items render from a template through a keyed morph (`payload-live-preview/structural`); an `aria-live` region announces connect, update and disconnect; the runtime binds again after a back/forward-cache restore or a soft navigation, and the Next.js, SvelteKit and Nuxt adapters wait for hydration before the first write.

## Compatibility

|                                                | Payload 2.x                                                                  | Payload 3.x                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Scalar field updates                           | ✅                                                                           | ✅                                                                    |
| Rich text (Lexical)                            | ✅                                                                           | ✅                                                                    |
| Relationship / upload population               | Collection GETs from the accepted schema with `serverURL` and matching depth | ✅ with `serverURL` (REST merge)                                      |
| Schema-driven field typing (`fieldSchemaJSON`) | ✅                                                                           | — (3.x removed it; DOM heuristics + Lexical auto-detection take over) |

<!-- compat-matrix:start -->

| Framework | Supported                                                                    | Tested in CI on every push (version, browsers)                                    |
| --------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Astro     | >=4.0.0 <8.0.0                                                               | 7.3.2 (chromium, firefox, webkit); 6.x (chromium); 5.x (chromium); 4.x (chromium) |
| Next.js   | App Router, 15.5 and 16                                                      | 16.3.8 (chromium, firefox, webkit); 15.x (chromium)                               |
| SvelteKit | 2.x                                                                          | 2.70.2 (chromium, firefox, webkit)                                                |
| Nuxt      | 3.x (end of life since 31 July 2026: kept working, not officially supported) | 3.21.11 (chromium, firefox, webkit)                                               |

Node >=20.19.0; the unit and integration suites run on Node 20, 22, 24, 26. Every version in the table is what the fixture lockfile or the matrix job installs, checked by `npm run compat:check`.

Vite 5 through 8: that is what the supported framework majors install (Astro 7 → 8, Astro 6 → 7, Astro 5 → 6, Astro 4 → 5, SvelteKit 2 → 5/6/7/8, Nuxt 3 → 7), measured 2026-09-06. `npm run compat:check` keeps the devDependency and the fixture lockfiles inside that span; `npm run compat:refresh` re-reads it from the registry.

The framework hooks and fragment renderers run twice on every push: at the floor of each peer range, which the `hook-matrix` job installs over the lockfile (React 18.0.0, Vue 3.3.0, Svelte 5.0.0), and at what the lockfile installs (React 19.2.8, Vue 3.5.42, Svelte 5.56.9); the SvelteKit renderer is measured against a component compiled by `svelte/compiler` and rendered by the real `svelte/server`.

- Payload 2.32.3: wire corpus captured from a real admin and replayed in tests/integration/wire-corpus.test.ts, plus fieldSchemaJSON typing in tests/integration/schema-driven.test.ts; local prerelease checks also exercise the real admin in DOM, React and Vue previews, each in frontend-only and serverURL modes (24 browser cases per variant), and run the React hook and the Vue composable through three lifecycle journeys (9 browser cases per variant) and seven guard journeys (21 browser cases per variant) in development builds; the legacy dependency graph retains upstream audit findings.
- Payload 3.85.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.88.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.89.0: wire corpus captured from a real admin, replayed in tests/integration/wire-corpus.test.ts.
- Payload 3.90.2: real admin E2E fixture (examples/payload-backend), run by CI on every push.
- Payload 4.0.0-canary.33: wire corpus captured from a real Payload 4 admin in a one-off upgrade round, replayed in tests/integration/wire-corpus.test.ts; the fixture itself stays on 3.x.
- Payload latest: daily protocol watch executes @payloadcms/live-preview@latest against the corpus.
- Payload 4.0 pre-releases: daily protocol watch against @payloadcms/live-preview@canary, early warning only.

<!-- compat-matrix:end -->

### Local 2.1 prerelease checks

The following checks passed on the `2.1.0` package archive on 2026-10-05. These are local results, separate from the CI jobs listed above. Browser counts include Chromium, Firefox and WebKit on Linux. The Payload 2.32.3 rows were run again on 2026-10-17 on a package archive built from this repository; `examples/payload-version-lanes` runs them, with `--probe=population`, `--probe=lifecycle` or `--probe=guards` for React and Vue.

| Version        | Checked population                                              | Passed cases                  |
| -------------- | --------------------------------------------------------------- | ----------------------------- |
| Payload 2.32.3 | DOM, React and Vue, each with frontend-only and serverURL modes | 24 per variant, six variants  |
| Payload 2.32.3 | React and Vue hook lifecycle, frontend-only and serverURL       | 9 per variant, four variants  |
| Payload 2.32.3 | React and Vue hook guards, frontend-only and serverURL          | 21 per variant, four variants |
| Node 20.19.0   | Peer-free runtime exports and bounded HTTP/Web API behavior     | 9 runtime cases               |
| Next.js 16.3.8 | Webpack production preview and fragment rendering               | 54 browser cases              |
| Astro 4.0.0    | Base adapter, static output and scoped updates                  | 15 browser cases              |
| Astro 4.16.19  | Native React islands, CSP and navigation ownership              | 12 browser cases              |

The Node checks do not cover framework builds or development tools. The Next checks use a controlled preview cookie and fragment tokens; they do not use a real Payload admin. The Payload 2 graph still has upstream audit findings, including a critical finding in the 2026-10-05 audit. Its passing preview cases establish compatibility, not a clean dependency graph. Payload 3 lifecycle and Payload 4 canary checks are not included in this table. The Payload 2 lifecycle and guards rows run development builds on Linux engines. The lifecycle row covers an owner replaced while a read is held, a document change by navigation and a reload of the preview frame. The guards row covers a late successful response of a replaced owner, messages from a foreign window and a foreign origin, a receiver switch in a running session and a sign-out in the middle of one; neither row covers a token that expires by time or a production build.

The two Astro rows can be repeated from the repository. The `astro-floor-base` and `astro-floor-islands` jobs run their specs on every push in Chromium ([Astro peer floors](docs/testing.md#astro-peer-floors)), and on 2026-10-17 the same specs passed in all three engines: 36 of 36 cases for Astro 4.0.0 (loader and inline delivery with five cases each, plus two control builds per engine; the 15 cases above were loader delivery only) and 12 of 12 for Astro 4.16.19.

**A client-rendered app takes a hook.** `useLivePreviewDocument()` from `payload-live-preview/react` or `payload-live-preview/vue` returns the merged document and re-renders your tree. Payload 3 updates use the method-override merge request; Payload 2 scalar updates settle locally and raw relationships use schema-based collection GETs. A newer update aborts any request in flight; an HTTP error is refused instead of becoming the document; each hook has a session of its own, so two previews on one page keep their own documents ([docs/react.md](docs/react.md), [docs/vue.md](docs/vue.md)). The official [`@payloadcms/live-preview-react`](https://payloadcms.com/docs/live-preview/client) / `-vue` hooks ship in lockstep with Payload and remain the safe default if that matters more to you; running either alongside the DOM runtime on one page: [docs/interop.md](docs/interop.md).

## Install

```bash
npm install payload-live-preview
```

The root `payload-live-preview` carries the client, the inline script generator, the renderers and four of the five built-in plugins; the unbound-fields overlay and `PluginManager` are on `payload-live-preview/plugins`. `payload-live-preview/plugin` configures Payload's root Live Preview panel, while `/payload` keeps the lower-level URL builder. `payload-live-preview/astro`, `/nextjs`, `/sveltekit` and `/nuxt` hold one framework adapter each; `/nuxt-module` registers the Nuxt one from `nuxt.config.ts` and takes `authorizePreview` by module reference, `authorizePreviewModule` ([docs/nuxt.md](docs/nuxt.md)). `payload-live-preview/server` is the privileged surface for server code: `definePreview()`, `authorizePreviewRequest()`, `issuePreviewToken()` and `createPreviewBindings()`. Every focused entry is listed in [docs/options.md](docs/options.md).

## Configure Payload

The config plugin enables mapped collections and globals, installs their shared
URL callback and can set the toolbar breakpoints. It is structural across
Payload 2.32.3 and 3.x and imports neither version:

```ts
import { livePreview } from 'payload-live-preview/plugin';

export default buildConfig({
  plugins: [
    livePreview({
      baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
      collections: {
        posts: ({ data }) => `/blog/${String(data['slug'] ?? '')}`,
        services: ({ data, locale }) => `/${locale ?? 'en'}/services/${String(data['slug'] ?? '')}`,
      },
      globals: {
        homepage: '/',
      },
      breakpoints: [
        { label: 'Mobile', name: 'mobile', width: 375, height: 667 },
        { label: 'Desktop', name: 'desktop', width: 1440, height: 900 },
      ],
    }),
  ],
});
```

Existing root collection/global lists are kept in order and deduplicated with
the mappings. Existing breakpoints stay when the option is omitted; supplying
it replaces the list. A competing root URL or a URL on a selected entity that
already exists when this transform runs is a configuration error. Make this
transform run after any plugin that may write a Live Preview URL in Payload's
effective execution order, or compose both routing policies explicitly. The
complete merge and conflict rules are in [docs/payload.md](docs/payload.md).

In the Payload 3.90.2 admin, a collection document gets its native Live
Preview after its first save. The create screen has no preview toggle and no
frame, for a function-valued URL and for a fixed string alike. The frame that
appears after the save loads the URL the plugin's function builds from the saved
document. `tests/real-payload/surface-create.spec.ts` checks this in Chromium,
Firefox and WebKit.

Use the lower-level callback when another plugin owns the surrounding config or
when a document may have no preview route:

```ts
import { buildLivePreviewUrl } from 'payload-live-preview/payload';

export default buildConfig({
  admin: {
    livePreview: {
      url: buildLivePreviewUrl({
        baseUrl: process.env.FRONTEND_URL ?? 'http://localhost:4321',
        collections: {
          posts: ({ data }) => `/blog/${String(data['slug'] ?? '')}`,
          services: ({ data, locale }) =>
            `/${locale ?? 'en'}/services/${String(data['slug'] ?? '')}`,
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

The helper appends `?preview=true`, one of the query parameters (`preview`, `draft`, `livePreview`) the adapters read as preview intent. The parameter is client-controlled: it selects delivery and never authorizes draft access. A hand-written `url: ({ data, locale, collectionConfig, globalConfig }) => string` callback works the same way; the [official docs](https://payloadcms.com/docs/live-preview/overview) have the full contract. The helper's nullable overload lets a resolver return `null` for a document without a route, and `fallback: null` declines every unmapped one; Payload 3 then shows no iframe. Payload 2.32.3's published callback result is string-only, so use the non-null overload and a string fallback there. The config plugin deliberately stays inside that common contract.

The config plugin accepts no signing secret or token option. Where no session
cookie crosses origins, the manual `signed-token` URL callback is a Payload 3
server-side integration only; never put its secret in a Payload 2 callback.
[docs/authorization.md](docs/authorization.md) explains that boundary, the
open multi-request token lifecycle, the `payload-session` and `verifier`
strategies, and the initial draft read.

## Quick start

### Astro

```js
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

On a static build there is no server to render it, so the fields are bound individually — and inside a boundary too. A direct patch retains the target element. A component render or fragment morph can retain it as well when type, key and position stay compatible, but may replace it when they do not:

```astro
<h1 data-payload-field="title">{title}</h1>
<div data-payload-field="body">…server-rendered rich text…</div>
<img data-payload-field="hero" alt={alt} src={url} />
```

Which to reach for, and what each costs: [docs/bindings.md](docs/bindings.md#how-much-markup-this-actually-needs). `pll-codegen annotate` adds the unambiguous bindings and names each one it refuses, with the reason; without `--write` it only reports, and exits with `3` when it found work.

That is it: the inline script detects the admin's iframe and starts patching. Rich text is detected from the value shape; `data-payload-richtext` only forces it. Payload 2.x and 3.x can post raw form values, so relationship and upload fields arrive as IDs until `serverURL` with `mergeDepth` re-fetches the populated document ([docs/options.md](docs/options.md)). Injection modes, request-time middleware, authorization and the initial draft read: [docs/astro.md](docs/astro.md).

### Other frameworks

- **Next.js (App Router)** — `<LivePreviewScript />` in `app/layout.tsx`, the adapter middleware for headers: [docs/nextjs.md](docs/nextjs.md).
- **SvelteKit** — `livePreviewHandle()` in `hooks.server.ts`: [docs/sveltekit.md](docs/sveltekit.md).
- **Nuxt** — a Nitro plugin plus a server handler: [docs/nuxt.md](docs/nuxt.md).
- **Plain HTML** — `generateInlineScript()` at build time: [docs/html.md](docs/html.md).

## Patch, fragment, route

A binding is patched in place by default. A `data-payload-fragment` boundary is rendered by your server from the unsaved form state instead — conditional sections, derived values, custom blocks, the component's own logic — and morphed into the page. Compatible retained nodes keep their focus and live properties; a node that changes kind, loses its pairing or crosses an ownership boundary is replaced and loses that state. The runtime posts the fields to the same-origin endpoint named in `fragments: { endpoint }`, built with `createFragmentEndpoint()`, which every adapter entry exports — Astro renders through its container API, Next.js through `react-dom/server`, SvelteKit through `svelte/server`, Nuxt through `vue/server-renderer` — and patches the boundary's own bindings when the server cannot render. With `routeStrategy: true` or `fragments` set, a binding in `<head>`, or one marked `data-payload-strategy="route"`, refreshes the whole route once per revision. The route morph follows the same retention rule and restores focus after a retained keyed move; it does not promise state for replaced nodes. Without either strategy the binding is patched like any other. The route is matched by top-level field name, so a dotted binding such as `meta.title` refreshes it only with `data-payload-depends="meta"`. Markup, endpoint, deployment requirements and the abuse model: [docs/hybrid.md](docs/hybrid.md).

Custom elements are protected from fragment, route and structural morphs by
default. Add the opt-in attribute `data-payload-morph` to a custom element in
your template when you want live preview to update its attributes and
server-rendered light DOM (the children inside the element).

```html
<my-component data-payload-morph>
  <!-- Server-rendered content that live preview can update -->
</my-component>
```

The attribute must appear on the element already on the preview page and in
the updated HTML returned by your template. Adding it to the template normally
covers both. The attribute opts in when present; its value is ignored.
Compatible hosts with the same tag and namespace retain their identity,
instance properties and listeners while attributes and light DOM update.
If only one version has the attribute, or the elements are incompatible, the
existing replacement behavior applies.
Shadow roots are never touched; islands, `data-payload-owned`, editable content
and nested protected descendants remain protected. Ordinary elements are unchanged.

The morph makes the host's attributes and light DOM match the server's markup,
so what a component added to its own host or built inside it is removed or
replaced on the next update (the state attributes `open`, `value`, `checked` and
`selected` are left alone unless the template names them). Keep markup a
component owns in its shadow root, or mark it `data-payload-owned`. Components
must react to child changes, refresh cached references, preserve UI state, and
clean up listeners or observers. `connectedCallback` does not rerun for child
updates; DOM moves can still reconnect a retained host. Consumers may emit the
marker only in preview mode on initial and subsequent renders; preview
detection stays in the application. See
[ADR 0008](docs/architecture/0008-keyed-morph-ownership.md#10-custom-element-light-dom-opt-in-2026-10-10).

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

- **Preview intent is not authorization.** The query parameter, the iframe destination and the referer are client-controlled; the adapters count the query alone by default. `allowedOrigins` governs browser `postMessage` senders and `shouldInject` filters routes; neither authenticates the request. `authorizePreviewRequest()` does, and where an adapter decides per request with `authorizePreview` — `createLivePreviewMiddleware()`, `livePreviewHandle()`, `livePreviewNitroPlugin()`, `defineLivePreviewServerHandler()` — that one result controls draft reads, `private, no-store` caching, CSP changes and runtime injection, and `<LivePreviewScript />` gates the Next.js script on the same verdict. Other setups decide less. Astro's build-time `inline` and `loader` modes and the synchronous `livePreviewScriptProps()` and `renderLivePreviewScript()` put the runtime or its bootstrap into every page that renders them, where it does not start outside a preview frame. Astro's `mode: 'middleware'` and the Nuxt module serialize their options, so they take the hook by module reference (`authorizePreviewModule`); with neither hook nor reference they refuse the strict default, and `defaults: 'v1'` (or `strict: false`) injects on intent alone.
- **Origin validation.** Every incoming message is checked against `allowedOrigins`; `document.referrer` is ignored by default, and after the first accepted update the inline runtime and `LivePreviewClient` lock to that origin (the React and Vue hooks do not). The adapters merge a `frame-ancestors` policy for the admin origins without clobbering the rest of your CSP.
- **Sanitization and URL validation.** Lexical and HTML writes in the browser pass a DOM sanitizer with a curated allow-list — `<script>`, `<form>`, `<iframe>`, `<svg>`, event handlers and `style` are rejected — and every `href`, `src`, `srcset` and `poster` must be `http(s)`, `mailto:`, `tel:` or relative; external links get `rel="noopener noreferrer"`. A server render sanitizes with the `document` it is given; without one, `lexicalToHtml()` returns custom renderers' markup as written and warns, and `requireDocument: true` makes it throw instead, the 3.0 default ([docs/security.md](docs/security.md#html-sanitization)).
- **Binding attributes are disclosure.** `data-payload-field` names a CMS field and `data-payload-owner` a document. `createPreviewBindings({ authorization })` suppresses them, companions included, on public responses. Never key CSS off `data-payload-*`.
- **Policed writes, no prototype pollution.** `data-payload-attribute` refuses event handlers, `style`, `srcdoc`, `formaction`, `form`, `id`, `name`, `is`, `srcset` and `imagesrcset`; nested lookups refuse `__proto__`, `prototype` and `constructor`, and incoming data is never merged into existing objects.

Full details in [docs/security.md](docs/security.md). Report vulnerabilities per [SECURITY.md](SECURITY.md).

## Troubleshooting

- **Nothing updates.** Run `__livePreview.inspect()` in the preview iframe's console first — the handle exists once the injected runtime has started inside a preview frame; a page that starts `LivePreviewClient` itself calls `client.inspect()`. It names the cause in most cases. The common ones: the admin origin is missing from `allowedOrigins`, the page is not inside an iframe, the bound element does not exist (an empty field needs an anchor).
- **Relationship fields show IDs.** Set `serverURL` with `mergeDepth`; Payload 3.x posts unpopulated form values.
- **The preview iframe refuses to load.** The host sets `X-Frame-Options` or a restrictive `frame-ancestors`. The adapters merge `frame-ancestors` on authorized preview responses, and browsers frame by that directive alone; an `X-Frame-Options: DENY` from a proxy still blocks a preview response that has none, so it must go there.
- **The adapter refuses the configuration.** The strict default needs `authorizePreview`, a non-empty `allowedOrigins` (`https:` in production) and no referer trust; `defaults: 'v1'` stages a migration one row at a time.

`inspect()` readings, `pll doctor` and every diagnostic code: [docs/troubleshooting.md](docs/troubleshooting.md). `pll doctor` sends its preview request with `?preview=true`; a preview behind `authorizePreview` is audited with an editor's credential. A signed token goes in the URL as `?previewToken=…`, which the visitor request drops; `--header "x-preview-token: …"` works only where the token strategy sets `transport: { kind: 'header' }`; a Payload session is `--header "Cookie: payload-token=…"`.

## Documentation

The reading path, with a glossary: [docs/README.md](docs/README.md).

- Framework guides: [Astro](docs/astro.md) · [Next.js](docs/nextjs.md) · [SvelteKit](docs/sveltekit.md) · [Nuxt](docs/nuxt.md) · [Plain HTML](docs/html.md) · [React hook](docs/react.md) · [Vue composable](docs/vue.md)
- [docs/bindings.md](docs/bindings.md) — data attributes, field types, owners, typed bindings and codegen
- [docs/payload.md](docs/payload.md) — Payload 2/3 config plugin, merge rules and URL conflicts
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
