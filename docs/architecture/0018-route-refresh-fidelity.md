# Snapshot-free route refreshes report partial fidelity

**Status:** Accepted • **Date:** 2026-09-24

This record supplements ADR 0011's route strategy and ADR 0004's local
reapply rule. It does not add a snapshot transport or change route ownership.

## Context

`createRouteStrategy()` has two successful paths. It either fetches the current
URL with a same-origin GET and morphs that HTML, or awaits a refresh function
registered by the host framework. Neither call receives the accepted live
preview document. A server may render a saved draft, published data, or data
made current through an independent preview session, but this strategy cannot
tell which one it received.

The runtime does know the accepted document in its own process. After a route
render it rebuilds the binding cache and reapplies that document. This restores
reachable scalar and structural bindings, but it cannot recreate conditional
markup, derived server values, an unbound section, or other output whose server
renderer never saw the unsaved revision. Calling the whole result current would
therefore be a fidelity claim the built-in strategy cannot prove.

## Options considered

1. **Report the existing route render as partial.** Keep the GET and host
   refresh, then expose that their data source was not proven to contain the
   current unsaved revision. This is bounded and requires no new credential or
   server state.
2. **Send the accepted snapshot to a route renderer.** This could produce the
   missing conditional and derived output, but only with request authorization,
   revision identity, byte and entry limits, expiry, cleanup, and a defined
   multi-instance story. A bodyless route GET is not that protocol.
3. **Use an authorized preview session.** The page renderer could read current
   server-side preview state without carrying fields in every request. That
   needs a separate lifecycle for entry proof, session scope, expiry, replay,
   and revocation.

The second and third options can provide full unsaved fidelity, but both depend
on authorization and capacity decisions outside this change. For 2.1 the first
option is the smallest truthful contract.

## Decision

`RouteOutcome` gains `partial`. The built-in `createRouteStrategy()` returns it
after both successful snapshot-free paths: GET plus morph, and an awaited host
refresh. A custom `RouteStrategy` may return `partial` for the same limitation.

`refreshed` remains valid and keeps its existing runtime behavior. It is now an
explicit assertion by a custom strategy that its renderer knew the current
unsaved revision. Existing custom strategies need no source change.

The runtime treats `partial` as a successful route render. It resets applied
value identities, restores auto-binding guesses, rebuilds the cache, reapplies
the accepted document, and emits the existing route and patch batches. It also
increments `inspect().route.partial`; that counter is a subset of
`inspect().route.refreshes`. A route batch reports work completed, not that
every server-derived part of the document is current.

## Consequences

- Bound unsaved values still return after the route render. The local reapply
  path does not change.
- Conditional, derived, unbound, and server-owned output may remain saved-only
  after a built-in refresh. Inspection now says so.
- Existing custom strategies that return `refreshed` keep working and report no
  partial refreshes. Authors should return `partial` when their renderer cannot
  prove it used the current unsaved revision.
- Consumers with an exhaustive `RouteOutcome` switch must handle the new
  `partial` member when upgrading to 2.1.
- A future bounded snapshot transport or preview session remains additive. It
  must not silently turn this partial contract into a full-current claim.

## Owner-scoped route planning (2026-09-28)

Under `scopeBindingsByOwner` an update reaches only what the document it names
owns, but the route planner still received the whole page: a
`data-payload-strategy="route"` marker or a route binding another document
owns asked for a refresh of this document's edit, one more request of the
route for nothing the editor could see (PHD-02). `RouteStrategy.plan` now
receives a third argument, a `RoutePlanContext` whose `inScope(element)` says
whether an element belongs to the update; it is `true` everywhere while
scoping is off. `createRouteStrategy()` skips markers outside the scope, and
the runtime's own route-binding check applies the same owner rule. A planner
with two parameters keeps working and plans for markers of every document, as
before. The late-binding path already checked owners.
`tests/unit/core/route-owner-scope.test.ts` and
`tests/e2e/specs/route-owner-scope.spec.ts` pin it; the native case asked for
one route request on the previous source in three browsers and none now.

## Addendum (2026-10-25): a saved-only render renders again on the save

A partial render shows the saved document, and nothing asked for the route
again once the document was saved: an unbound field kept its old value in the
preview until the next change in the form. Payload posts
`payload-document-event` after every save, the autosave included, and only once
the save has landed. When the route was last rendered `partial` for a revision,
the runtime now runs the route strategy once more on that event and reapplies the
current revision onto the fresh markup. The render the save asked for does not
arm the next one, so a second save with nothing new in between asks nothing; a
full (`refreshed`) render or a new route starts clean. The render is still
reported as `partial`: the strategy cannot prove that the save held the newest
revision. Payload 2 posts no document event, so nothing changes there.
`tests/unit/core/route-after-save.test.ts` pins the runtime and
`tests/e2e/specs/unbound-route-fallback.spec.ts` the browser path, in Chromium,
Firefox and WebKit.

## Addendum (2026-10-28): what a route-bound path and a navigation ask for

A route-bound element on a path inside a field never asked for a refresh:
`data-payload-strategy="route"` on `layout.1.note`, or a `<head>` binding of
`meta.title`. Both planners compared the element's path with the top-level
names the diff produces. They now receive the touched fields together with the
paths inside them that route-bound elements name and that changed. A path
changes with its field; under `subfieldCoverage: 'declared'`, which keeps the
previous message, only when the value at the path changed. A custom planner
that reads top-level names sees them as before.

The replay after `refreshAfterNavigation()` asked for a refresh that could
bring nothing. It counts every field as changed, so on a route that binds little
of the document every field was an unbound change, and the route the
navigation had just rendered was fetched again: measured on a site about 35 ms
after the swap, replacing what the host had added since. The replay is now
answered like a partial render: no refresh, and the next save renders the
route. A route marker still refreshes after a navigation.
`tests/unit/core/route-nested-paths.test.ts` and
`tests/unit/core/route-after-save.test.ts` pin both.
