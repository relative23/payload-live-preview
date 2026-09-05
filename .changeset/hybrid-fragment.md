---
'payload-live-preview': minor
---

Hybrid preview (ADR 0011, the fragment protocol and its abuse model): a
`data-payload-fragment` boundary is rendered by the site's server from the
unsaved form state and morphed in with focus and visitor state intact.
`createFragmentEndpoint()` on the Astro entry renders only a registry of
components, for an authorized preview bound to the page route, from a
same-origin JSON POST within body-size and time limits;
`payload-live-preview/fragment` is the browser half
(`createFragmentStrategy()`), with one revision-bound request per boundary,
dedupe, a concurrency cap, timeouts and response validation. A failure
patches the boundary from the same revision and reports `LP0801`–`LP0806`; a
superseded revision aborts its requests. Adapters take
`fragments: { endpoint }`; the injected runtime then carries the fragment
client, and a page without it gets the plain runtime.

The route strategy refreshes the whole route once per revision for head or
`data-payload-strategy="route"` bindings — scroll and focus kept, the revision
re-applied on the fresh markup, a second request refused with `LP0805`.
Strategies are resolved per binding (explicit attribute, fragment boundary,
head, patch) and dirty fields are coalesced per boundary and route, the
`dependencies` registry included. Events gain `fragmentRender` and
`source: 'patch' | 'fragment' | 'route'`; `inspect().fragments` and
`inspect().route` report counts. docs/hybrid.md covers the setup.
