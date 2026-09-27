# ADR 0011 — The fragment protocol and its abuse model

**Status:** Accepted • **Date:** 2026-08-27

Planned as "ADR 0005 (fragment protocol and abuse model)" before that number
was taken by plugin ownership.

## Context

Patching (ADR 0008) brings unsaved form state into server-rendered HTML
without a reload, as long as the markup that shows a field already exists.
It cannot create a section a template renders only when a field is set,
compute a derived value, or run a component's own logic. The hybrid preview
planned for 1.7.0 asks the real component renderer to do that for one
boundary at a time — which means a browser asking a server to render
something from request-controlled data, on behalf of an editor. That is
the part that needs a threat model before an endpoint.

## Decision

### 1. Markup and runtime contract

- A boundary is an element with `data-payload-fragment="<id>"`; `<id>` is a
  registry key (`[a-z][a-z0-9-]{0,63}`, case-insensitive), never a path,
  module or function name. `data-payload-fragment-key` distinguishes several
  boundaries of one id; `data-payload-depends="a,b"` limits which fields
  re-render it (none: every update does).
- The runtime core carries a **seam**, not the client: `strategies.fragment`
  plans which boundaries a revision touches and receives a context with the
  capabilities it may use — morph (Trusted Types and the keyed morph apply),
  the fallback patch of the boundary's own bindings, and event reporting —
  plus the revision's abort signal. Bindings inside a planned boundary are
  not patched; the boundary is the server's. Measured: the seam costs the
  plain inline runtime +1 050 B gzip (24 936 → 25 986); the client is a small prelude the
  generator emits ahead of the runtime only for a page with `fragments`
  (`src/fragment/inline.ts`, looked up as `__LIVE_PREVIEW_FRAGMENT__`), so a
  patch-only page carries none of it and every page shares one runtime.
- The client (`payload-live-preview/fragment`) posts one request per
  boundary and revision, shares identical requests within that revision's abort
  signal, caps concurrency (4), times out (5 s), validates the response (JSON,
  shape, size, boundary id and key, revision) and maps every failure to an
  `LP08xx` outcome. The signal is the internal generation identity when a new
  runtime or owner session reuses a revision number. A superseded revision
  aborts its requests and removes requests that are still waiting for a
  concurrency slot. A request cancelled after permit handoff returns that
  permit without starting its fetch. A late response is discarded by revision;
  a failure is patched from the same revision's data, so the editor never sees
  stale content presented as current, and slow fragment A can never overwrite
  fast fragment B.
- Events: `fragmentRender` per boundary and revision (`rendered` /
  `failed` with the code); `afterUpdate` with `source: 'fragment'` once
  the revision's fragments settled; `error` with `context: 'fragment'`.
  `inspect().fragments` reports handler presence and counts.

### 2. Wire protocol (`@/types/fragment-protocol`, version 1)

Request: `POST <endpoint>` on the page's own origin, `application/json`,
`credentials: same-origin`, header `x-payload-fragment-version: 1`, body
`{ fragment, key?, route, search, revision, locale?, collectionSlug?,
globalSlug?, fields }` — `route` and `search` are the page's own, so the
server authorizes the fragment request exactly as it would the page.
Response: `{ html, boundary: { id, key? }, revision, metadata: {
renderedAt, renderer, durationMs? } }` with `Cache-Control: private,
no-store`, `X-Content-Type-Options: nosniff`, `Vary: Cookie`. A refusal is a
status and one generic word (`{"error":"unauthorized"}`), never a reason.

### 3. Server contract (`createFragmentEndpoint`, Astro first)

The endpoint renders only what its **registry** names: `{ [id]: {
component, props(input) } }`. Props are computed by the server from the
input (fields, locale, slugs, route, the authorized context); nothing in
the request selects code, templates, import paths or filesystem paths.
The default renderer is Astro's container API (`astro/container`,
created once per process); a `render` override exists for tests and other
component systems. Static-only deployments cannot serve it: fragments
need a server (an Astro SSR adapter or a separate preview rendering
service); the docs say so.

### 4. Abuse model — and where each control is verified

| Threat                                                 | Control                                                                                                                                                                                                                              | Verified in                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| SSR injection (request chooses what runs)              | Registry lookup by id only (own properties; prototype names refused); props computed server-side; no paths, templates or code cross the wire.                                                                                        | `astro-fragments.test.ts` (404 for unknown/prototype ids)  |
| Confused deputy (site renders for a non-editor)        | `authorizePreviewRequest()` with the site's strategy on the **page route + query** the client reports, under the request's own cookies/headers.                                                                                      | 403 without a token, 403 for a token of another route      |
| Token leakage                                          | The token travels only as it already does for the page (query/cookie); responses are `no-store`; refusals carry no detail.                                                                                                           | headers asserted on every response                         |
| Cross-site request forgery                             | `Sec-Fetch-Site` must be `same-origin`/`none`; `Origin` must match the page origin or an explicit allow-list; JSON content type required.                                                                                            | 403 cross-site / foreign origin; 415 non-JSON              |
| Amplification / resource exhaustion                    | Streamed body limit (64 KiB of consumed bytes), field depth limit (12), one body-read and separate props/render timeouts (5 s each), abort-aware client concurrency cap (4) and dedupe; rate limiting is the deployment's.           | 413 / 408 / 400 / 500; endpoint and client tests           |
| Cross-tenant access (a token for document A renders B) | Exact locale when scoped. Opt-in `scope.payload` also binds document kind, slug and ID before props/render, plus expiry and any site audience/path; Payload read depth is checked by `definePreview`, not inferred from form fields. | `fragment-document-scope.test.ts`, `preview-scope.test.ts` |
| Stale content shown as current                         | Revision-bound requests, abort on supersession, fallback patch on failure, visible `LP08xx` code.                                                                                                                                    | `fragment-strategy.test.ts`, `client.test.ts`              |

The body cap counts the bytes exposed by `Request.body` while they are read.
`Content-Length` may reject a request early, but it never admits one. Crossing
the cap returns `413 {"error":"body"}` and stops application reads. A body-read
deadline returns `408` with the same generic error; an abort, a disturbed or
locked body, or a reader failure returns `400 {"error":"body"}`. JSON or a
request shape that is invalid after a complete read remains
`400 {"error":"shape"}`.

An early declared-length refusal does not cancel a stream the endpoint never
acquired. Some framework bridges map that cancellation to destroying the
underlying request before they can write the `413`; disposal of that unread
transport remains the bridge's responsibility. Once the endpoint acquires a
reader, it cancels on an actual overrun, deadline, abort or read failure.

Whether those bytes are before or after decompression depends on the host and
its proxy. The host must therefore apply its own wire-size, decompression and
request-rate limits. `limits.timeoutMs` spans the complete body read and then
applies separately to props and rendering. Those timers cannot interrupt
synchronous component code; an execution hard limit also belongs to the host.

### 4a. One request lifetime (2026-09-24)

`limits.totalTimeoutMs` is an opt-in deadline covering body reading,
authorization, props and rendering together. The existing `timeoutMs` body and
props/render windows keep their defaults and meanings. The total deadline
returns `504 {"error":"timeout"}`; a client abort after reading the body returns
`400 {"error":"request"}`. Body failures keep the responses above, and a
props/render phase timeout remains `500 {"error":"render"}`.

Each accepted POST owns one controller. The page request passed to the
authorizer follows its signal; props and the renderer receive it as
`FragmentRenderInput.signal`. The Payload-session verifier links that signal
to its `/me` request while retaining its own shorter timeout. The endpoint
stops waiting even if a consumer ignores the signal, consumes late rejections,
and does not start another phase or accept a late result after stopping.
Listeners and timers are released when the endpoint settles.

Cancellation is cooperative. A deadline does not terminate JavaScript,
revoke a database write, or undo replay-token consumption that already started.
Synchronous CPU needs host isolation; concurrent-request and rate limits remain
deployment responsibilities. This change introduces neither a shared server
queue nor a default limit that would serialize unrelated editors.

The shared endpoint joins the critical coverage and nightly mutation scope on
2026-09-24. The first full coverage measurement is 97.83% lines, 97.43%
functions and 93.66% branches; the new file ratchets are 97/97/93. Existing
ratchets are unchanged. A separate two-file mutation run records 642 mutants;
the exact full-scope baseline must be remeasured before release, not inferred
by adding this report to an older one.

### 4b. Native HTTP/1 transport ownership (2026-09-24)

The native lifetime probes found that adapter-node 5.5.7 / SvelteKit 2.70.2
does not abort its Web Request after upload completion, and H3 1.15.11 does
not connect that signal at all. SvelteKit also destroys its incoming Node
request when a Web body reader is cancelled, losing an otherwise valid 504.

The server bindings add a request-local bridge for a supplied native HTTP/1
request. SvelteKit receives it through `event.platform.req`; Nuxt's handler
accepts the H3 event as an optional second argument, preserving its existing
one-argument Web Request form. A socket close and the original request signal
both abort the effective request. Listeners leave on success, refusal and
exception. No Node import, H3 dependency, process-global state or queue enters
the portable endpoint. Other hosts retain their supplied Web Request semantics.

The bridge borrows the original body through a zero-prefetch stream. On early
termination it releases the reader and pauses the native request, without
cancelling the framework stream or draining discarded data in the background.
An unread or partially read body requires `Connection: close` on the response:
the HTTP/1 server flushes the refusal before closing that connection. A fully
read request keeps normal keep-alive. Host wire/body limits still apply; this
bridge is not an HTTP/2 stream adapter and does not close a multiplexed socket.

This is an additive minor integration seam alongside the total-deadline API.
The seven native failures remain acceptance tests. Required counterchecks are
unread/oversized/stalled bodies, pre-existing abort, incomplete-upload disconnect,
reader/listener cleanup, normal completion and keep-alive reuse. A real socket
observer is independent of the bridged cancellation signal: seeing disconnect
alone does not establish that application work stopped. TLS proxies must relay
their downstream close separately; an upstream-only pass does not prove that.

### 5. What stays out

- No unsigned query-only fragment endpoint: authorization is mandatory.
- No generalisation to other frameworks' endpoints before the Astro one has
  run against a real admin in three engines (the 1.7.0 release gates). The
  client option `fragments` is framework-neutral because the policy engine
  is; only the Astro endpoint helper exists.
- The morph never crosses an island: a boundary inside `astro-island` or
  `data-payload-island` is never planned.

2026-09-17 (2.0.2): the Astro endpoint helper is not the only one.
`createFragmentEndpoint` is exported by `payload-live-preview/nextjs`,
`payload-live-preview/sveltekit` and `payload-live-preview/nuxt` as well, each
a binding of the shared handler in `src/adapters/shared/fragment-endpoint.ts`.

## Consequences

- A page opts in per boundary; everything else keeps patching.
- The plain inline runtime grew by the seam (recorded in
  `scripts/bundle-budgets.ts`); the inline script with the prelude is a
  separate budget, and the adapter bundles carry the prelude once.
- Deployments that render fragments need a server. The docs list the
  requirements and the rate-limit guidance.

## Route strategy (1.7.0)

A binding in `<head>` or one marked `data-payload-strategy="route"` refreshes
the whole route once per revision (`src/fragment/route.ts`): a same-origin
GET with `x-payload-live-preview: route`, the head synced, `<body>` morphed
with the top-level boundaries keyed (`data-payload-fragment`,
`data-payload-island`) so they pair by identity, scroll restored, then the
revision re-applied. One refresh per revision and a 1 s minimum interval,
both `LP0805`. Focus survival through a whole-route refresh is covered by
the route unit test (jsdom); the browser E2E asserts the route refresh
itself — content, head title, scroll, and `route.refreshes` — because a
focused control's survival across a full-document morph is engine-sensitive
and the fragment path (which is what a focused editor field sits in) keeps
focus in all three engines.

The head reconciler owns only the first unowned `<title>`, direct unowned
`meta[name]` and `meta[property]` children, and direct unowned
`link[rel="canonical"]` children. It projects that managed sequence in server
order, including duplicates, complete attribute removal and surplus deletion.
Scripts, styles, charset and HTTP-equivalent metadata, non-canonical links,
nested elements and anything marked `data-payload-owned` stay with their
existing owner.
