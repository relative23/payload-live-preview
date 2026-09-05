# Deployment

What a preview response looks like on the wire, what sits between the admin
and the page, and what each layer must let through. The audit for a deployed
site is `pll doctor` ([troubleshooting.md](troubleshooting.md#auditing-a-deployment-pll-doctor)).

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

## The loader asset (Astro `mode: 'loader'`)

A statically built site has no server to decide per request. In loader mode
every page carries a bootstrap of a few hundred bytes, and only a page that
finds itself in a preview context appends the runtime as a separate asset:

```
/_payload-live-preview/runtime.<hash>.js
```

The path sits below Astro's `base`. The file is written into the build output
by the integration and served by `astro dev` from memory at the same path, so
development and production load identical bytes. Its properties decide how to
host it:

- **Content-hashed and configuration-free.** The bytes depend only on the
  package version; the configuration is assigned inline by the bootstrap. The
  asset can be cached for as long as the host allows — its name changes with
  the package, never with the site. `astro dev` serves it with
  `Cache-Control: no-cache` so a package upgrade is picked up at once.
- **Subresource integrity.** The bootstrap loads the asset with an `integrity`
  attribute (`sha384-…`) and `crossorigin="anonymous"`. A host, proxy or
  optimizer that rewrites, minifies or re-encodes JavaScript changes the bytes,
  the browser refuses the file, and the bootstrap does not retry: the preview
  never starts. Exclude the path from any such rewriting.
- **An inline bootstrap.** The bootstrap is an inline `<script>` in the head
  of every page. A `Content-Security-Policy` with a `script-src` must allow it
  (a hash or a nonce), and allow `'self'` for the asset.

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
