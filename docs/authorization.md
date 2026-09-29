# Authorization

`?preview=true`, an iframe destination and an admin referer are intent: the
browser chooses them. Everything privileged — the draft read, the forwarded
credential, `private, no-store` caching, the CSP change, the runtime
injection, the binding attributes — is keyed on one verified decision instead.

`authorizePreviewRequest(request, strategy)` makes that decision. It resolves
to an **authorization**: `{ authorized: true, outcome: 'authorized', context }`
or `{ authorized: false, outcome, context: null }`. The **outcome** is a
string: `'authorized'`, `'missing-credential'`, `'invalid'`, `'expired'`,
`'wrong-audience'`, `'wrong-path'`, `'wrong-locale'`, `'wrong-purpose'`,
`'replayed'` or `'unavailable'`. A refusal is a value, never an exception; only
a misconfigured strategy throws (`PreviewConfigurationError`), on its first
use — the first preview request that reaches the hook, not startup.

The `context` is an `AuthorizedPreviewContext`: frozen, branded, produced
only there, carrying `strategy`, `subject`, `authorizedAt`, `expiresAt`,
`scope` (`audience`, `path`, `locale`, optional `payload`) and `payloadHeaders`, the request
material a draft read forwards to Payload. A copy or a JSON round trip is not
accepted anywhere. Threat model: [ADR 0006 — Authorized preview context](architecture/0006-authorized-preview-context.md).

## Strategies

### `payload-session`

The editor's own Payload session. The site forwards exactly one cookie
(`payload-token` by default) to `GET <serverURL>/api/<usersSlug>/me?depth=0`
and authorizes when a user of that collection comes back: `subject` is the
user id, `payloadHeaders` carries the cookie, a draft read runs as the editor.
Payload side: the ordinary preview URL from `livePreview()` in
`payload-live-preview/plugin`, or from the lower-level `buildLivePreviewUrl()`
in `payload-live-preview/payload`; the cookie travels with the iframe request
when it reaches the site at all. Site side, on any adapter:

```ts
// src/middleware.ts (Astro)
import { createLivePreviewMiddleware } from 'payload-live-preview/astro';
import { authorizePreviewRequest } from 'payload-live-preview/server';

export const onRequest = createLivePreviewMiddleware({
  allowedOrigins: [import.meta.env.PUBLIC_PAYLOAD_ADMIN_ORIGIN],
  authorizePreview: (request) =>
    authorizePreviewRequest(request, {
      type: 'payload-session',
      serverURL: import.meta.env.PAYLOAD_URL,
    }),
});
```

Options: `serverURL` (required), `usersSlug` (`users`), `cookieName`
(`payload-token`), `timeoutMs` (`3000`, floor `250`), `maxCookieLength`
(`4096`). A missing, repeated or malformed cookie is `'missing-credential'`; a
`401`, or a `/me` answer with no user or with one from another auth collection,
`'invalid'`; a session whose `exp` has passed `'expired'`; any other failure
`'unavailable'`.

When the request supplies an `AbortSignal`, the `/me` fetch follows it as well
as the strategy's own timeout. An aborted check returns `'unavailable'`, even
if the transport later returns a user. Fragment endpoints pass their request
lifetime through this signal; custom verifiers can forward `request.signal`
to their own I/O. Cancellation cannot undo a side effect that already ran,
including consumption of a one-use token.

### `signed-token`

A short-lived HMAC-SHA256 token minted on the Payload side and verified by
the site, for previews where no cookie crosses origins. It is bound to the
site (`audience`), the path, the locale, a purpose and a lifetime.

The callback below is a manual **Payload 3 server-side** integration. Payload
2.32.3 invokes its Live Preview URL callback in the admin browser, so a signing
secret must not be put there. `payload-live-preview/plugin` therefore accepts
no token or secret option and never appends `previewToken`.

One URL token may be presented more than once: page entry, fragment requests
and reloads can each verify it. An atomic one-use replay store will refuse the
later request after the first consumes the token. Until that lifecycle has a
scoped server-side continuation, this recipe is not a turnkey one-use-token
flow for every preview mode. Prefer `payload-session` or a server-owned
`verifier` where possible; do not weaken replay checks to make the example
appear to work.

Payload 3 side — mint it into the preview URL:

```ts
// payload.config.ts (Payload 3; this callback must remain server-side)
import { buildLivePreviewUrl } from 'payload-live-preview/payload';
import { issuePreviewToken } from 'payload-live-preview/server';

const toPreviewUrl = buildLivePreviewUrl({ baseUrl: process.env.FRONTEND_URL!, collections: { … } });

url: async (args) => {
  const url = new URL(toPreviewUrl(args));
  const locale = typeof args.locale === 'string' ? args.locale : args.locale?.code;
  const claims = { audience: url.origin, path: url.pathname, ...(locale ? { locale } : {}), ttlMs: 10 * 60_000 };
  url.searchParams.set('previewToken', await issuePreviewToken(claims, { secret: process.env.PREVIEW_TOKEN_SECRET! }));
  return url.toString();
},
```

Site side:

```ts
authorizePreview: (request) =>
  authorizePreviewRequest(request, {
    type: 'signed-token',
    secret: import.meta.env.PREVIEW_TOKEN_SECRET,
    audience: import.meta.env.SITE_ORIGIN, // this site's origin, e.g. https://www.example.com
    locale: (request) => new URL(request.url).pathname.split('/')[1],
  }),
```

Claims (`issuePreviewToken`): `audience` (required), `path` (recommended),
`locale`, `subject`, `purpose` (`live-preview`), `ttlMs` (ten minutes, capped
at one hour). Strategy options: `secret` (at least 32 bytes), `audience`,
`purpose`, `transport` (`{ kind: 'query', param }`, default `previewToken`,
or `{ kind: 'header', name }`, default `x-preview-token`), `locale` (a
resolver; without one a token carrying a locale is `'wrong-locale'`) and
`replay` (a store whose `consume(id, expiresAt)` checks and records in one
step, see [docs/security.md](security.md); none is shipped, and the deprecated
`isUsed`/`markUsed` shape lets two simultaneous requests with one token both
pass). `scope` carries the
bindings; `payloadHeaders` is empty, so a draft read sends only what you pass
as `headers` — a server-side credential of your own, never one from the request.

### `verifier`

Your own check, for SSO or edge authentication. `verify` returns claims
(`subject`, `expiresAt` in Unix ms, `scope`, `payloadHeaders`) or `null`
(`'invalid'`); a throw is `'unavailable'`, a passed `expiresAt` `'expired'`:

```ts
authorizePreview: (request) =>
  authorizePreviewRequest(request, {
    type: 'verifier',
    verify: async (request) => {
      const session = await sso.read(request.headers.get('cookie'));
      if (session === null) return null;
      const Authorization = `users API-Key ${process.env.PAYLOAD_PREVIEW_API_KEY!}`;
      return { subject: session.userId, expiresAt: session.expiresAt, payloadHeaders: { Authorization } };
    },
  }),
```

## The site side per framework

The hook runs on requests carrying preview intent. A refusal leaves the
response as rendered: no runtime, no CSP change, no nonce. An authorized
request gets the runtime, the merged `frame-ancestors`, `Cache-Control:
private, no-store` and `Vary: Cookie`, and the adapters publish the decision:

| Framework | Where                                                    | Keys                                                                              |
| --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Astro     | `Astro.locals`, from `createLivePreviewMiddleware()`     | `livePreviewAuthorization`, `livePreviewAuthorizationOutcome`, `livePreviewNonce` |
| SvelteKit | `event.locals`, from `livePreviewHandle()`               | same                                                                              |
| Nuxt      | `event.context`, from `defineLivePreviewServerHandler()` | same; the `render:html` plugin reuses that decision instead of authorizing again  |
| Next.js   | none — middleware has no request context                 | call `authorizePreviewRequest()` in the route or layout that reads the draft      |

`livePreviewAuthorization` is set only when the hook authorized;
`livePreviewAuthorizationOutcome` whenever it ran; `livePreviewNonce` on every
request except a refused preview. `LivePreviewLocals`, exported from
`payload-live-preview/astro`, `payload-live-preview/sveltekit` and
`payload-live-preview/nuxt`, types all three: extend Astro's `App.Locals`,
SvelteKit's `App.Locals` or Nuxt's `H3EventContext` (module `h3`) with it, as
the guides show ([docs/astro.md](astro.md), [docs/sveltekit.md](sveltekit.md),
[docs/nuxt.md](nuxt.md)). Astro's `mode: 'middleware'` and the Nuxt module
serialize their options into the build, so they take the hook by module
reference: `authorizePreviewModule` names a server module whose default export
it is ([ADR 0024](architecture/0024-authorization-by-module-reference.md)).

## Draft documents on first load

The initial render is the server's job. `definePreview()` binds origin, route
and depth once and takes the authorization on every read: a real context reads
the draft and forwards its `payloadHeaders`, `null` reads the published document.

```astro
---
import { createPreviewBindings, definePreview } from 'payload-live-preview/server';

const preview = definePreview({ serverURL: import.meta.env.PAYLOAD_URL, depth: 1 });
const authorization = Astro.locals.livePreviewAuthorization ?? null;
const result = await preview.fetchDocument<Page>({
  collection: 'pages',
  where: { slug: { equals: Astro.params.slug } },
  authorization,
});
if (!result.ok) return new Response(null, { status: 503 }); // or log result.reason
const page = result.data;
const bindings = createPreviewBindings({ authorization, owner: `collection:pages:${page?.id}` });
---
```

In Nuxt the read is a Nitro route, and `defineLivePreviewServerHandler()`
runs on that request too: forward the page's query (`useFetch(url, { query:
useRoute().query })`) so it carries the intent — server rendering forwards the
cookie itself — and the decision lands on `event.context`. The bindings come
from the same context in the page ([docs/nuxt.md](nuxt.md#read-eventcontext)):

```ts
// server/api/pages/[slug].get.ts
import { definePreview } from 'payload-live-preview/server';

const preview = definePreview({ serverURL: process.env.PAYLOAD_URL!, depth: 1 });

export default defineEventHandler(async (event) => {
  const result = await preview.fetchDocument<Page>({
    collection: 'pages',
    where: { slug: { equals: getRouterParam(event, 'slug') } },
    authorization: event.context.livePreviewAuthorization ?? null,
  });
  return result.ok ? result.data : null;
});
```

`fetchDocument` and `fetchGlobal` return `{ ok, data, draft, status }` or
`{ ok: false, reason, status, cause }` (`reason`: `http`, `network`,
`timeout`, `aborted`, `invalid-json`, `no-fetch`, `scope`); `errorMode: 'throw'`
throws `PreviewFetchError`. Per-read options: `authorization`, `locale`,
`headers` (the context's win on conflict), `signal`, `errorMode`. `depth`
serves the read and the runtime merge alike: spread `preview.runtimeOptions`
into the adapter. The same `authorization` gates the binding attributes
([docs/bindings.md](bindings.md)) and the fragment endpoint ([docs/hybrid.md](hybrid.md)).

### Bind a verifier to one Payload document

A server-owned verifier can add `scope.payload` with `serverURL`, optional
`apiRoute` (default `/api`), `document` and `maxDepth`. Use a server-selected
mapping after verifying the editor, not a target copied from request JSON.
A collection document is `{ kind: 'collection', slug: 'pages', id: 'page-id' }`;
a global is `{ kind: 'global', slug: 'homepage' }`. This capability requires a
finite `expiresAt`. The context copies and freezes the nested binding.

For such a collection context, replace the `where` query above with explicit
`id: 'page-id'` and supply the bound `locale`. `fetchDocument` then uses the
direct document REST endpoint, not `limit=1`. A missing/different ID, `where`,
other collection/global, different Payload API base, excessive configured
depth, missing/wrong scoped locale or expired context returns `reason: 'scope'`
without a request. No public-read fallback or private-header forwarding runs.
The same failure mode rejects a mismatched response identity or a response
that arrives after expiry. Direct-ID reads also work without a capability;
`id` and `where` cannot be combined. IDs and slugs in a capability must be safe
path segments, without URL delimiters, percent escapes, whitespace or dot
segments. Numeric IDs match their string representation.

Shared fragment endpoints enforce the document binding before props/render,
and expiry again after each phase. Missing collection `fields.id` is refused;
globals need the exact `globalSlug`, and an explicit `fields.globalType` must
agree. A refusal is generic `403 {"error":"unauthorized"}`. The population
depth limit applies to `definePreview` requests, not to arbitrary component
code or the nesting of unsaved form fields.

Existing contexts without `scope.payload` keep their 2.x query-read behavior.
Neither signed tokens nor the Payload-session strategy creates this binding
implicitly. This does not replace Payload ACLs, create a browser session, or
make server-only credentials available to the browser's merge path. Custom
renderers, custom fetch implementations and Local API calls remain trusted
application code. See [ADR 0006 §5c](architecture/0006-authorized-preview-context.md#5c-opt-in-payload-document-capability-2026-09-25).

## Token leakage

A signed token travels in a query parameter by default, which browser
history, the `Referer` header, server and CDN logs and error reporters see.
The bindings make a leaked token worth one path on one site for a few
minutes. To shrink that: prefer the session strategy; send the token in the
`x-preview-token` header where you control the fetch; set `Referrer-Policy:
no-referrer` on preview responses; keep `previewToken` out of log formats and
error-reporter URLs; supply a replay store ([docs/security.md](security.md)).

## Admin and site on different domains

Cookies do not cross registrable domains. Admin on `cms.example.com` and
site on `www.example.com` can share a cookie scoped to the parent domain;
when the two share nothing, the site never receives it and `payload-session`
refuses as `'missing-credential'`. Use a server-owned `verifier`, or on Payload
3 the manual server-side `signed-token` callback above. Both sides then need
the shared verification material; the config plugin does not carry it. The REST
merge behind `serverURL` runs in the browser, from the preview page to the
Payload API, as a `POST` with `credentials: 'include'`.
Across origins that is a CORS request with credentials: Payload's `cors` and
`csrf` settings must list the site origin, or the merge fails and the runtime
renders the raw values. The `payload-session` check is server-to-server and
needs no CORS. Deployment details:
[docs/deployment.md](deployment.md#admin-and-site-on-different-domains).
