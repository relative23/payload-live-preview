# ADR 0028 — A host route refresh settles after the host commits

**Status:** Proposed • **Date:** 2026-09-29

This record states when a route refresh the host lends the runtime is done,
what the runtime does with one that cannot say, and how the four frameworks'
navigation is proven in production.

## Context

The route strategy either fetches the route and morphs it into the page, or,
when the host lent it one with `registerRouteRefresh()`, calls the host's own
refresh (the React component `LivePreviewRouteRefresh` lends Next's). After the
refresh the runtime re-applies the unsaved revision, so it has to wait until
the host has committed the fresh render; writing into the markup being
replaced loses the edit until the next message.

`RouteRefresh` is typed `() => void | Promise<void>`. The strategy awaits the
result, which settles at once when it is `undefined`. Next's `router.refresh()`
returns nothing and commits later; `LivePreviewRouteRefresh` wraps it in a
transition whose end it waits for, and the SvelteKit and Nuxt recipes await
their data reload and the next tick. A hand-registered function that returns
nothing on a host that renders later cannot be told apart from one that
rendered synchronously. Since the 2.1 navigation work (M7) the strategy
reports a host refresh as `partial` rather than `refreshed`, and adapters
whose page dispatches the package's commit event replay the unsaved document
after the host's own navigation commit.

## Decision

### 1. `void` means already committed, and the runtime says it could not wait

A refresh that returns nothing is taken as having committed when it returned.
Because that is also what an asynchronous host returning nothing looks like,
the strategy says so once per page under `debug` as `LP0810`, naming the
promise and `LivePreviewRouteRefresh`. The guide states the contract.

### 2. 3.0 requires the promise

In 3.0 `RouteRefresh` is `() => Promise<void>` (ADR 0007 ledger row 23). A
synchronous host returns `Promise.resolve()`; there is nothing to rewrite
mechanically.

### 3. Navigation is proven in production, per framework

The navigation and replay cases of the Next.js, SvelteKit and Nuxt specs run
against production servers (`next start` over TLS, SvelteKit's Node adapter,
Nuxt's Nitro node output) in Chromium, Firefox and WebKit, beside the Astro
soft-navigation spec. A fixed delay is never the proof: every case waits on a
committed DOM or the runtime's own events.

## Alternatives

- **Wait for the commit event after a `void` refresh.** It only exists on
  pages that dispatch it, and a refresh that commits nothing would then wait
  for the timeout on every edit.
- **Poll the DOM for a change.** An unchanged render is a valid outcome.
- **Require the promise in 2.1.** A breaking type change on a minor release.

## Consequences

- An adapter recipe or component that returns the promise is unaffected; a
  hand-written `void` refresh gets one debug line.
- Acceptance: the route strategy cases for a `void` and a promised refresh;
  the three production configurations in three browsers; the full chain and
  the nightly.
