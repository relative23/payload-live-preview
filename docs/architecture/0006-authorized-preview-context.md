# ADR 0006 — Authorized preview context: threat model and authorization strategies

**Status:** Accepted • **Date:** 2026-08-27

## Context

Every framework adapter, the draft-fetch helpers and the binding DSL make a
privileged decision on each request: whether to inject the runtime, relax the
Content-Security-Policy, expose a nonce, read a draft instead of the published
document, bypass a page cache, or emit `data-payload-*` attributes that reveal
the content model. Through 1.0.x those decisions were keyed on _intent_ —
`?preview=true`, `Sec-Fetch-Dest: iframe`, or an admin referer. All three are
chosen by the client. A public visitor can produce every one of them.

`docs/security.md` §0 has said since 1.0 that intent is not authorization and
that integrations must verify a session or a signed token before acting. The
package offered no way to express that verification, so each integration built
its own (sala's `authorizePreviewRequest` is the proven one), and the adapters
could not tell an application-verified request from a merely intended one.
Finding F-09 records the consequence: `shouldInject` was the only hook, and it
is a route filter, not an authorization boundary.

1.1.0 introduces one first-class decision — `AuthorizedPreviewContext` — and
gates every privileged response change on it. This record fixes the threat
model that decision has to hold against **before** the token strategy is coded,
because a token format is cheap to write and expensive to change.

## Assets

1. **Draft content.** Unpublished documents, including ones that will never be
   published. Reading a draft is the primary privilege.
2. **Content model disclosure.** `data-payload-field`, `data-payload-owner` and
   companion attributes name collections, globals, field paths and document
   ids. On a public response they map the schema for free.
3. **Script execution context.** Injecting the runtime and adding a nonce to
   `script-src` widens what may execute on the page. Relaxing `frame-ancestors`
   lets the page be framed by the admin origin; on an unauthorized response it
   lets the page be framed by whoever can make the request look like a preview.
4. **Cache integrity.** A preview response must never be stored as the public
   response, and a public response must never be served to an editor as a
   preview. Package-owned cache decisions (`fetchPreview*` bypass) share the
   gate; application caches (sala's page cache) consume the same verdict.
5. **The editor's session.** Whatever proves authorization — a Payload session
   cookie or a signed token — is itself an asset once it leaves the admin.

## Adversaries

- **A1 — anonymous visitor.** Controls the URL, every request header including
  `Referer` and `Sec-Fetch-Dest`, and can embed the site in an iframe on a page
  they own. Cannot read the editor's cookies.
- **A2 — passive observer of URLs.** Sees query strings through the `Referer`
  header on outbound links, server and CDN access logs, browser history and
  sync, error reporters that capture the page URL, and shared screenshots.
- **A3 — replaying party.** Obtains a previously valid credential (via A2 or a
  leaked preview link) and presents it later or elsewhere.
- **A4 — hostile embedding page.** A page that frames the site or opens it as a
  popup and posts `payload-live-preview` messages into it. Out of scope here —
  the runtime's origin allow-list and `eventSourcePolicy` (this release) handle
  message ingress; this record covers the HTTP response decision.

Out of scope: a compromised admin origin, a compromised editor browser, and a
compromised application server. Each of those already holds the assets.

## Decision

### 1. One branded verdict, produced only by verification

`AuthorizedPreviewContext` is a frozen object carrying a symbol brand —
a registry symbol (`Symbol.for`), because the root entry and each adapter
entry are separate bundles and a per-bundle `Symbol()` would make the
adapter refuse what the root produced.
`authorizePreviewRequest()` is the only producer inside the package.
`isAuthorizedPreviewContext()` checks the brand at runtime, so a plain object
literal, a `true`, or a cast survives type-checking only by deliberate effort
and fails at the gate. The context records the strategy that produced it, the
subject if known, the scope it is bound to (audience, path, locale), when it
was produced, when it expires, and the **minimal** forwardable material a
draft read needs (`payloadHeaders`: exactly the one verified cookie for the
session strategy, nothing for the others unless the verifier supplies it).

### 2. Three strategies, one result shape

`authorizePreviewRequest(request, strategy)` resolves to
`{ authorized: true, outcome: 'authorized', context }` or
`{ authorized: false, outcome, context: null }`. The outcome names why a
request was refused (`missing-credential`, `invalid`, `expired`,
`wrong-audience`, `wrong-path`, `wrong-locale`, `replayed`, `unavailable`) so an
application can count refusals without inspecting credentials — the shape sala
already records. It is a result, not an exception: absence of authorization is
the normal case for every public request.

- **`payload-session`.** Extracts exactly one cookie by name (default
  `payload-token`), rejects an absent, duplicated or oversized value, and asks
  the Payload server `GET /api/<users>/me` with only that cookie forwarded.
  A user in the response authorizes; anything else — including a network
  error or timeout — refuses (`unavailable` is a refusal). The request carries
  a bounded timeout so a slow admin cannot hold every public request.
- **`signed-token`.** A short-lived HMAC-SHA256 token issued by the Payload
  side (`issuePreviewToken`) and verified by the site. See §3.
- **`verifier`.** A consumer-supplied async function that returns claims or
  `null`. This is how an integration with its own session model (SSO, a custom
  cookie, mutual TLS at the edge) obtains the same branded verdict without the
  package re-implementing its authentication.

### 3. Token format and bindings

`v1.<base64url(claims)>.<base64url(HMAC-SHA256(secret, "v1." + claims))>`

Claims are a JSON object with short keys: `aud` (audience: the site's origin,
required), `pth` (request pathname the token is valid for), `loc` (locale, when
the site is localized), `sub` (subject, optional), `pur` (purpose string,
default `live-preview`), `iat`, `exp` (Unix milliseconds), `jti` (128-bit
random id). Verification checks, in order: structural shape, signature (via
`SubtleCrypto.verify`, constant time), `exp` against the clock with no skew
allowance beyond what the issuer set, `aud` equal to the configured audience,
`pur` equal to the configured purpose, `pth` equal to the request pathname when
present, `loc` equal to the resolved request locale when present, and finally
the optional replay store. Every failure is a distinct outcome. Nothing in the
token is encrypted: it carries no draft content and no secret, only bindings.

Why these bindings:

- **Audience** stops a token issued for staging from opening production, and a
  token for one site from opening another that shares the secret by mistake.
- **Path** stops a token leaked from one preview page (A2) from reading drafts
  of every other page. It is the request's pathname, not the full URL, so
  query parameters the runtime adds do not break it.
- **Locale** stops a token for `/de/` from opening `/th/` where the site has
  per-locale drafts.
- **Purpose** stops a token minted for another feature under the same secret
  from being accepted here.
- **Issue time and expiry** bound A2 and A3 to a window. The default TTL is
  ten minutes: long enough for the admin to open the iframe and for the page
  to load through a slow connection, short enough that a leaked link in a
  shared screenshot is dead by the time it is read.
- **`jti`** enables replay detection where an application chooses to store
  seen ids (`replay` option). The package does not ship a store — a store is a
  deployment decision (memory per process is useless behind a load balancer) —
  and says so instead of pretending.

Not bound: client IP (breaks behind mobile carriers and proxies), user agent
(free to forge, breaks on browser updates). Long-lived bearer tokens are not
offered: `ttlMs` is capped at one hour and the docs say why.

### 4. Leakage channels and the controls the token must survive

| Channel                                           | Control                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Referer` on outbound links from the preview page | Short TTL and path binding limit what a leaked token opens. Docs recommend `Referrer-Policy: no-referrer` or `strict-origin` on preview responses, and the header transport (`x-preview-token`) for integrations that control the fetch. |
| Server and CDN access logs                        | Same TTL and bindings. Docs instruct to exclude the token parameter from log formats; the token carries no content, so a logged one is a bounded, not a permanent, exposure.                                                             |
| Browser history and sync                          | TTL. The admin iframe URL is the leak; the docs say not to hand preview links around.                                                                                                                                                    |
| Error reporters capturing the URL                 | Same. Docs list the parameter as one to scrub.                                                                                                                                                                                           |
| Shared screenshot of the admin                    | TTL.                                                                                                                                                                                                                                     |
| Replay after expiry                               | `exp` — refused.                                                                                                                                                                                                                         |
| Replay within TTL from another path or site       | `pth`, `aud` — refused.                                                                                                                                                                                                                  |
| Replay within TTL on the same path                | Accepted unless the application supplies a replay store. Documented as the residual risk of query-string transport; the session strategy has no such residual because it forwards a cookie the browser scopes.                           |

### 5. What the gate covers

The adapters' shared policy (`createPreviewPolicy`) takes the verdict as an
input. When an `authorizePreview` hook is configured and refuses, the decision
is `{ inject: false, cspMode: false }` and the nonce is not exposed to
`locals`/`context`, regardless of intent, `autoInject` or `shouldInject`. The
draft helpers accept the context as their `authorization` and derive `draft`
and forwarded headers from it. `createPreviewBindings` accepts the context and
emits nothing without one. A boolean `authorized` remains accepted through 1.x
for integrations that verified elsewhere; `strict` mode requires the context.

When no hook is configured the 1.0 behaviour — intent only — remains, because
removing it is a 2.0 change. Outside production a development warning names
the gap once per process. `strict: true` turns the warning into a
configuration error.

## Consequences

- One verification per request, at the adapter, feeds every privileged
  decision; sala's application glue (cookie extraction, `/me` call, outcome
  metrics) becomes package code with the same behaviour.
- The token strategy makes a secure `buildLivePreviewUrl` possible without a
  session: the Payload side mints, the site verifies, no cookie crosses origins.
- Query-string transport is a documented trade-off with a residual replay
  window; integrations that want none use the session strategy or a replay
  store.
- The brand is a type-level promise plus a runtime check, not a cryptographic
  one. Inside the application's own process that is the correct strength: the
  process already holds the secret.
