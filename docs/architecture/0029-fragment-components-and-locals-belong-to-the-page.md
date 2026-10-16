# ADR 0029 — A fragment's components and its request context are the page's

**Status:** Proposed • **Date:** 2026-10-01

This record extends ADR 0020's rule for Astro resources to SvelteKit, measured,
and gives a fragment's `props` the same request context a page's `load` has.

## Context

A fragment endpoint renders a registered component from the unsaved form
state, and the runtime morphs the result into the page. Two things a page
render has were missing from that path in SvelteKit.

**Component CSS.** SvelteKit links the scoped CSS of the components a route
imports. Measured on the SvelteKit fixture in three browsers: a section that a
fragment adds inside a component the page already renders gets that
component's scoped rule; a component only the endpoint imports arrives with
its scoped class and no rule on the page. ADR 0020 measured the same on Astro
and chose a page-owned catalog.

**Request context.** A page's `load` reads `event.locals`, which the
application's hooks fill for every request: a session, a locale, a client. The
fragment endpoint received the request and its verified authorization, not
`locals`, so a `props` function could not compute what `load` computes from
them. Astro's `context.locals` and Nuxt's `event.context` have the same role
and were not passed either.

## Decision

### 1. Components a fragment may render are imported by the page

As in ADR 0020: the page imports every component its endpoint may render and
renders it inside its boundary, empty if the current document has nothing for
it yet. The framework then links the component's CSS with the page. No styles
travel in a fragment response; the sanitizer is unchanged.

### 2. `props` receives the request's own server context

`FragmentRenderInput` gains `locals`: Astro's `context.locals`, SvelteKit's
`event.locals`, Nuxt's `event.context`, as each adapter's endpoint is handed
them; Next.js route handlers have no such object, so it is `undefined`. It is
what the application's server code set on the fragment request, typed
`unknown`. The endpoint passes it through and reads nothing from it. An
endpoint called without it hands `undefined`, never the context of another
request.

## Alternatives

- **Return the component's CSS in the fragment response.** Styles from a
  response the browser asked for would need their own sanitizer and CSP story,
  and a stylesheet's lifetime belongs to the page (ADR 0020).
- **Copy the page request's locals.** The fragment request is its own request;
  its hooks run, and what they set is the context that matches its
  authorization.
- **Type `locals` per adapter.** The package cannot name `App.Locals` or a
  Nuxt context type; the application narrows.

## Consequences

- Additive: an endpoint wrapper that does not pass a context keeps working,
  and `props` that ignore `locals` are unchanged.
- The SvelteKit fixture's `/hybrid` imports `Notice`, rendered only by
  fragments, and reads a value its own hook set in both `load` and `props`.
- Acceptance: unit cases for the four adapters; the SvelteKit browser case red
  without the import and against the previous package, green with both, in
  three browsers; the full chain and the nightly.
