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
