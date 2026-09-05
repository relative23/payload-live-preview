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
  boundary and revision, shares identical requests, caps concurrency (4),
  times out (5 s), validates the response (JSON, shape, size, boundary id,
  revision) and maps every failure to an `LP08xx` outcome. A superseded
  revision aborts its requests; a late response is discarded by revision;
  a failure is patched from the same revision's data, so the editor never
  sees stale content presented as current, and slow fragment A can never
  overwrite fast fragment B.
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

| Threat                                                 | Control                                                                                                                                                   | Verified in                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| SSR injection (request chooses what runs)              | Registry lookup by id only (own properties; prototype names refused); props computed server-side; no paths, templates or code cross the wire.             | `astro-fragments.test.ts` (404 for unknown/prototype ids) |
| Confused deputy (site renders for a non-editor)        | `authorizePreviewRequest()` with the site's strategy on the **page route + query** the client reports, under the request's own cookies/headers.           | 403 without a token, 403 for a token of another route     |
| Token leakage                                          | The token travels only as it already does for the page (query/cookie); responses are `no-store`; refusals carry no detail.                                | headers asserted on every response                        |
| Cross-site request forgery                             | `Sec-Fetch-Site` must be `same-origin`/`none`; `Origin` must match the page origin or an explicit allow-list; JSON content type required.                 | 403 cross-site / foreign origin; 415 non-JSON             |
| Amplification / resource exhaustion                    | Body limit (64 KiB), field depth limit (12), render timeout (5 s), client concurrency cap (4) and dedupe; rate limiting is the deployment's (documented). | 413 / 400 / 500 on timeout; client concurrency test       |
| Cross-tenant access (a token for document A renders B) | The authorized context's scope is checked against the request (locale today; collection/id when the strategy carries them).                               | `scopeAllows` in the endpoint                             |
| Stale content shown as current                         | Revision-bound requests, abort on supersession, fallback patch on failure, visible `LP08xx` code.                                                         | `fragment-strategy.test.ts`, `client.test.ts`             |

### 5. What stays out

- No unsigned query-only fragment endpoint: authorization is mandatory.
- No generalisation to other frameworks' endpoints before the Astro one has
  run against a real admin in three engines (the 1.7.0 release gates). The
  client option `fragments` is framework-neutral because the policy engine
  is; only the Astro endpoint helper exists.
- The morph never crosses an island: a boundary inside `astro-island` or
  `data-payload-island` is never planned.

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
