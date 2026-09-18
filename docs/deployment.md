# Deployment

What a preview response looks like on the wire, what sits between the admin
and the page, and what each layer must let through. The audit for a deployed
site is `pll doctor` ([troubleshooting.md](troubleshooting.md#auditing-a-deployment-pll-doctor)).
Its preview request carries `?preview=true`, the intent a 2.0 adapter counts.
A preview behind `authorizePreview` refuses that request without an editor's
credentials, so pass them the way the strategy reads them: a Payload session as
`--header "Cookie: payload-token=…"`, a signed token in the URL
(`pll doctor "https://www.example.com/page?previewToken=…"`, which the visitor
request drops), or `--header "x-preview-token: …"` only where the strategy sets
`transport: { kind: 'header' }`. Headers go with the preview request only and
their values are never printed; the URL is printed as given.

## Preview responses and caches

An adapter changes a response only after preview intent held and
`authorizePreview` — required under the `strict` default — accepted the
request: it injects the runtime and merges `frame-ancestors` into the CSP.
Every response it changes is sent with

```
Cache-Control: private, no-store
Vary: Cookie
```

An existing `Cache-Control` that already says `no-store` is kept; `Cookie` is
appended to an existing `Vary` unless it lists `Cookie` or `*`. A response the
adapter did not change — no intent, or a refused request — keeps whatever
headers the application set, so the public page stays cacheable.

A CDN or page cache in front of the site must honor those two headers: never
store a preview response, and never serve a stored public page to a request
that carries preview intent. The second case is the one that goes wrong
quietly: the preview URL differs from the public one only by its query
(`?preview=true`), so a cache whose key drops the query string hands the admin
the public page — no runtime, no `frame-ancestors`, and `pll doctor` reports
`LP0701`. Keep the query in the cache key, or bypass the cache for the intent
parameters.

A page cache you run yourself should consume the same authorization the adapter
did: Astro, SvelteKit and Nuxt expose it as `livePreviewAuthorization` on the
request locals, and its outcome as `livePreviewAuthorizationOutcome`
([authorization.md](authorization.md)). The fragment endpoint of a hybrid
preview answers every request with `Cache-Control: private, no-store`
([hybrid.md](hybrid.md)).

## The runtime as a cached asset

By default the runtime is part of the page. It can be a separate file instead:
every page then carries a bootstrap of a few hundred bytes, and only a page
that finds itself in a preview context fetches the runtime. Measured on the
Next.js fixture, that is a 1 331-byte `<script>` element in the page instead
of a 125 215-byte one — about one per cent, and more than the Astro row below
because a Next page's bootstrap also arms the wait for React's first commit
before it fetches ([ADR 0015](architecture/0015-first-write-after-hydration.md)). On Next it is the second step down, not the first: a layout
that can await the verdict renders `<LivePreviewScript />` and sends a public
visitor nothing at all ([nextjs.md](nextjs.md#nothing-for-a-public-visitor));
the asset is for a script built at module scope, with no verdict to await.

Two ways in, because the frameworks differ in who can serve a file:

| Framework                | Option              | Where the file comes from                                               |
| ------------------------ | ------------------- | ----------------------------------------------------------------------- |
| Astro                    | `mode: 'loader'`    | the integration emits it into the build and `astro dev` serves it       |
| Next.js, SvelteKit, Nuxt | `delivery: 'asset'` | a route you mount, from `createRuntimeAssetRoute()` and its equivalents |

```
https://example.com/payload-live-preview/runtime.<hash>.js    delivery: 'asset' (default assetPath)
https://example.com/_payload-live-preview/runtime.<hash>.js   Astro mode: 'loader' (below Astro's base)
```

The hash is the same on both, because it is the hash of the bytes. Astro keeps
the underscore: it is a build output directory, and an underscore is exactly
what makes a folder private to the App Router and to SvelteKit, so the
route-serving adapters cannot use one. Their properties are otherwise
identical, and they decide how to host the file:

- **Content-hashed and configuration-free.** The bytes depend only on the
  package version and the artifact (`runtime: LEAN_RUNTIME` is a different
  hash); the configuration is assigned inline by the bootstrap. The asset can
  be cached for as long as the host allows — its name changes with the package,
  never with the site. The mounted route says so itself:
  `Cache-Control: public, max-age=31536000, immutable`. `astro dev` serves its
  copy with `Cache-Control: no-cache` instead, so a package upgrade during
  development is picked up at once.
- **One name, one set of bytes.** The route answers the file name this build
  produces and 404s every other, rather than serving current bytes under an old
  name. That is what makes the year-long `immutable` honest.
- **Subresource integrity.** The bootstrap loads the asset with an `integrity`
  attribute (`sha384-…`) and `crossorigin="anonymous"`. A host, proxy or
  optimizer that rewrites, minifies or re-encodes JavaScript changes the bytes,
  the browser refuses the file, and the bootstrap does not retry: the preview
  never starts. Exclude the path from any such rewriting.
- **An inline bootstrap.** The bootstrap is an inline `<script>` in the head
  of every page. A `Content-Security-Policy` with a `script-src` must allow it
  (a hash or a nonce), and allow `'self'` for the asset.

## What a public visitor pays

The runtime is about 112 KB of JavaScript (about 35 KB gzip). The number that
matters is not that but who receives it, and that is decided by the delivery
rather than by the framework. Three outcomes, each held by an E2E case in
`tests/e2e/specs/public-response.spec.ts` against the budgets in
`tests/fixtures/delivery-budgets.ts`, read off a request with no cookie and no
preview intent. What that case pins to the byte is the delivery's overhead: the
`<script>` element, tag included, minus the runtime it embeds. The runtime is
gated on its own (`INLINE_BUDGET` in `scripts/bundle-budgets.ts`) and grows
with the package, so the Bytes column is the whole element as this page was
written: the pinned overhead, plus the 113 468-byte runtime in the two rows that
carry it.

| Setup                                                  | A public visitor receives | Bytes          | Why                                                                               |
| ------------------------------------------------------ | ------------------------- | -------------- | --------------------------------------------------------------------------------- |
| SvelteKit handle, Nuxt Nitro plugin, Astro middleware  | nothing                   | 0              | something ran for the request, saw no intent, and injected neither                |
| Next.js, `<LivePreviewScript />` in the root layout    | nothing                   | 0              | an async server component can await the verdict, so it renders nothing at all     |
| Next.js, `delivery: 'asset'`                           | the bootstrap             | 1 331, twice   | the root layout renders for everyone; what it renders is the bootstrap            |
| Astro static build, `mode: 'loader'`                   | the bootstrap             | 772            | a static page has no request to decide for, so the check happens in the browser   |
| Astro static build, `mode: 'inline'`                   | the whole runtime         | 113 604        | nothing decides and nothing is deferred                                           |
| Next.js, `livePreviewScriptProps()` in the root layout | the whole runtime         | 125 215, twice | a synchronous helper cannot await a verdict, so it builds the script for everyone |

The last row is the one exception to "no cookie, no preview intent": no fixture
serves it to the public any longer, because the Next example moved to the second
row. What is measured there now is the same layout answering an _authorized_
editor — same helper, same bytes, one request apart from the zero above it. It
stays in the table because a synchronous helper in a root layout is what most
Next projects have today, and this is what it costs them. That is also the shape
of the win: the component did not make the delivery cheaper, it stopped the
public paying for it.

The bootstrap in either row that carries it checks whether the page is framed
or opened by an admin, and outside a preview it fetches nothing. The Next one is
larger because it also arms the wait for React's first commit, before that
check; the rest of the difference is the configuration in front of each. So a
visitor to a statically built site pays under one per cent of what the inline
build costs them, and a visitor to a site whose server decides pays nothing at
all.

772 bytes is the floor of this table, and it is not zero. A page built ahead of
time has no request to decide for, so the check has to travel with the page;
`mode: 'loader'` is the one delivery here that cannot reach zero, and saying so
is more useful than a smaller number that stops being true the moment somebody
measures it. Every other delivery can, because something of ours runs while the
request is still open.

"Twice" is Next's doing, not ours: a script in a layout is rendered once into
the HTML and once more into the RSC flight payload underneath it, escaped and
therefore slightly larger the second time. A Next page ships its delivery two
times, which is what makes the choice between those two rows the widest in the
table.

Three ways to move a row up:

- **A Next.js layout or page**: render `<LivePreviewScript />` from
  `payload-live-preview/nextjs` instead of spreading
  `livePreviewScriptProps()`. It is an async server component, so it can await
  the authorization verdict and render nothing — not a bootstrap, nothing — for
  a request that is not an authorized preview. It is the only way a Next page
  reaches the top row, because it is the only one that can decline to render
  ([nextjs.md](nextjs.md)). Note that a layout is handed the request headers and
  cookies but not its URL, so `?preview=true` is invisible there: use
  `inject: 'always'` and let `authorizePreview` be the single gate, or render the
  component in a page, which does get `searchParams`.
- **A page whose script is rendered for everyone**: switch it to
  `delivery: 'asset'` (Next.js, SvelteKit, Nuxt) or `mode: 'loader'` (Astro).
  The bootstrap replaces the runtime, and the runtime is fetched only inside a
  preview.
- **Bindings in the public markup**: `data-payload-*` attributes are a few dozen
  bytes each and harmless, but they also describe your content model to anyone
  who reads the page. `createPreviewBindings()` keyed on the authorization
  verdict emits them only for an authorized preview — the SvelteKit fixture's
  public response carries no `data-payload-*` at all
  ([authorization.md](authorization.md)).

Intent alone never buys anything: a request that claims `?preview=true` without
passing `authorizePreview` gets the public response byte for byte, which is the
last case in that spec.

## Proxies that strip or add headers

The adapter sets headers on the response it returns; what reaches the browser
is whatever the last hop in front of the site lets through.

- **`X-Frame-Options`.** Older than CSP and honored independently of it: a
  `DENY`, or a `SAMEORIGIN` when the admin is on another origin, blocks the
  preview iframe no matter what `frame-ancestors` says. It is usually set by a
  proxy or a security middleware rather than by the app. Remove it for
  authorized preview responses. The audit reports it as `LP0703`.
- **`Content-Security-Policy`.** The adapter merges `'self'` and the admin
  origins into the `frame-ancestors` directive of the existing header. A proxy
  that replaces the header with its own policy undoes that merge; a config can
  say `allowedOrigins` while the served policy admits nothing.
  `pll doctor --admin <origin>` verifies that the served directive admits the
  admin (`LP0702`).
- **Cache headers.** A proxy that overrides `Cache-Control` re-enables the
  caching the adapter turned off; see the previous section.

## Edge runtimes

The adapter entries (`payload-live-preview/astro`, `/nextjs`, `/sveltekit`,
`/nuxt`), `payload-live-preview/server`, `/fragment` and `/payload` run in a
Web-platform-only context: no `process`, no `Buffer`, no `node:` module. That
is executed, not declared — the package build loads every one of those entries
into such a context and drives a preview request through it. Signed tokens use
Web Crypto (`crypto.subtle`), which edge runtimes provide.

Two things behave differently where `process` does not exist:

- **Development warnings are silent.** The one-time warning an adapter prints
  when it gates on intent alone (`strict: false` without `authorizePreview`)
  is issued only outside production, which it reads from `process.env.NODE_ENV`.
  Without `process` the environment counts as production and nothing is
  printed.
- **`strict` treats the runtime as production.** Its `https:` requirement for
  `allowedOrigins` applies, and an `http:` origin fails at startup.

`pll doctor`, `pll migrate` and `pll-codegen` are Node command-line tools and
are not part of the deployed application.

## A smaller runtime for pages that need less

Every page that carries the runtime carries about 35 KB gzip of it. A site
whose preview needs neither server-rendered boundaries nor keyed arrays can
carry about 28 KB instead:

```ts
import { LEAN_RUNTIME } from 'payload-live-preview/lean';

livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
```

What it leaves out — the fragment and route strategies, the keyed morph, the
structural arrays, the item templates, the screen-reader announcer — and what a
page is told when it needs one anyway (LP0104): [options.md](options.md) and
[troubleshooting.md](troubleshooting.md). Everything else is the same runtime:
the same message bus, the same origin rules, the same merge, the same renderers
for text, numbers, dates, images, uploads, relationships and rich text.

The import is what puts the artifact in your build, so a project that stays on
the default ships nothing extra.

## A static site with the fragment endpoint as a service

A hybrid preview renders `data-payload-fragment` boundaries on the server, and
a static-only build has no process to render in. Run the endpoint as a separate
preview rendering service on the same origin — a reverse-proxy path — and
rate-limit that path at the edge. The requirements are listed under
[What a deployment needs](hybrid.md#what-a-deployment-needs) in the hybrid
guide.

## Admin and site on different domains

Two things stop working the moment `cms.example.com` and `www.example.com` are
not the same site.

**The admin cookie does not reach the site.** The `payload-session` strategy
verifies the admin's cookie on the preview request, and a browser does not send
`cms.example.com`'s cookie to `www.example.com`. Use the `signed-token`
strategy instead: the Payload side mints a short-lived token in the
`admin.livePreview.url` callback (`issuePreviewToken`, secret
`PREVIEW_TOKEN_SECRET`, at least 32 bytes) and the adapter verifies it
without any cookie. The token is bound to the site origin, the path, the
locale and its lifetime; [authorization.md](authorization.md) covers the
strategies and [security.md](security.md) what a leaked token is worth.

**The `serverURL` merge is a cross-origin request.** With `serverURL` set, the
runtime in the preview page re-fetches every update from Payload's REST API
with `credentials: 'include'`, so Payload must accept a credentialed
cross-origin request from the site: list the site origin in Payload's `cors`
and `csrf` settings, and let the auth collection's cookie travel cross-site
(`SameSite=None; Secure`). Without that, the merge fails, the runtime falls
back to the raw values, and relationship fields show IDs.

## Upgrading a monorepo

The Payload side imports `payload-live-preview/payload` (`buildLivePreviewUrl`)
and `issuePreviewToken`; the site imports the adapter, `authorizePreviewRequest`
and `payload-live-preview/server`. Keep both on one version of the package —
one entry in one lockfile is the simplest way — and at least on the same
major.

A signed token is `v1.<claims>.<signature>`, with a version field inside the
claims as well; the verifier refuses any other prefix as `invalid`. Signed
tokens ship with 2.0, so there is no earlier token format for a 2.0 site to
accept: an admin still on 1.x mints no token, and a 2.0 adapter under its
`strict` default refuses the preview request and serves the public page. When
the two deploy separately, deploy the site first, so the verifier is never
older than the issuer, and run `pll doctor` against a page after each deploy.

## Navigation

The runtime binds a document. Three kinds of navigation change what that means:

- **Back/forward cache.** A page restored from the bfcache re-runs no script,
  so a runtime that stayed attached would be bound to a frozen document. The
  inline runtime listens for `pagehide` (suspend: release the message ingress
  and observers, keep the configuration) and `pageshow` with `persisted: true`
  (start again on the same instance). A consumer who starts the client
  themselves gets the same behavior from `bindNavigationLifecycle(client)`.
- **A swapped `document.body`.** Some routers replace the body element on
  navigation, leaving observers on a detached node. The runtime watches the
  document element for that and rebinds its observers and cache to the new
  body on its own.
- **Soft navigation inside the body.** View Transitions and client routers
  (Astro's client router, the Next.js, SvelteKit and Nuxt routers) replace
  parts of the body without a load. The runtime's mutation observer sees
  bindings appear and vanish and rebuilds the cache after a 100 ms debounce.
  The inline runtime binds no router event — only the host knows which its
  router fires — so a page that needs an immediate rebuild calls
  `__livePreview.refresh()` from its router's after-navigation hook, or
  passes `softNavigationEvents: ['astro:page-load']` to
  `bindNavigationLifecycle` when it drives the client itself.

While suspended the runtime receives nothing. On restore it sends the `ready`
handshake again and the admin answers with the current document, so the page
catches up without an editor's keystroke.
