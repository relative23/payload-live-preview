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
a misconfigured strategy throws (`PreviewConfigurationError`), at startup.

The `context` is an `AuthorizedPreviewContext`: frozen, branded, produced
only there, carrying `strategy`, `subject`, `authorizedAt`, `expiresAt`,
`scope` (`audience`, `path`, `locale`) and `payloadHeaders`, the request
material a draft read forwards to Payload. A copy or a JSON round trip is not
accepted anywhere. Threat model: [ADR 0006 — Authorized preview context](architecture/0006-authorized-preview-context.md).

## Strategies

### `payload-session`

The editor's own Payload session. The site forwards exactly one cookie
(`payload-token` by default) to `GET <serverURL>/api/<usersSlug>/me?depth=0`
and authorizes when a user of that collection comes back: `subject` is the
user id, `payloadHeaders` carries the cookie, a draft read runs as the editor.
Payload side: the ordinary preview URL from `buildLivePreviewUrl()` in
`payload-live-preview/payload`; the cookie travels with the iframe request
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
(`4096`). A missing, repeated or malformed cookie is `'missing-credential'`, a
`401` `'invalid'`, any other failure `'unavailable'`.

### `signed-token`

A short-lived HMAC-SHA256 token minted on the Payload side and verified by
the site, for previews where no cookie crosses origins. It is bound to the
site (`audience`), the path, the locale, a purpose and a lifetime. Payload
side — mint it into the preview URL:

```ts
// payload.config.ts
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
`replay` (an `isUsed`/`markUsed` store; none is shipped). `scope` carries the
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
[docs/nuxt.md](nuxt.md)). Astro's `mode: 'middleware'` serializes its options
into the build and cannot carry the hook; register
`createLivePreviewMiddleware()` yourself.

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
`timeout`, `aborted`, `invalid-json`, `no-fetch`); `errorMode: 'throw'`
throws `PreviewFetchError`. Per-read options: `authorization`, `locale`,
`headers` (the context's win on conflict), `signal`, `errorMode`. `depth`
serves the read and the runtime merge alike: spread `preview.runtimeOptions`
into the adapter. The same `authorization` gates the binding attributes
([docs/bindings.md](bindings.md)) and the fragment endpoint ([docs/hybrid.md](hybrid.md)).

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
refuses as `'missing-credential'` — use `signed-token`, which needs only the
shared secret. The REST merge behind `serverURL` runs in the browser, from
the preview page to the Payload API, as a `POST` with `credentials: 'include'`.
Across origins that is a CORS request with credentials: Payload's `cors` and
`csrf` settings must list the site origin, or the merge fails and the runtime
renders the raw values. The `payload-session` check is server-to-server and
needs no CORS. Deployment details:
[docs/deployment.md](deployment.md#admin-and-site-on-different-domains).
