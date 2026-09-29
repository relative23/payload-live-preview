# ADR 0023 — A revision reports how completely the page shows it

**Status:** Proposed • **Date:** 2026-09-29

This record adds a headless, per-revision display state to the DOM runtime,
an acknowledgement for islands and the message revision to the hooks'
snapshot. It changes no default and no existing counter.

## Context

Between an accepted message and what the editor sees lie several steps that
succeed or fall short on their own: the merge with the populated document,
the writes into bindings, fragment renders, a route refresh, and island or
framework commits. `inspect()` counts each of them across the session
(`revisions.completed`, `fragments.failed`, `route.partial`,
`fidelity.unfaithful`), and events report single steps. Nothing says, for one
revision, whether the page now shows it. `revisions.completed` means that the
scheduled writes landed and no boundary is pending, which is true of a
revision whose boundary fell back to a patch, whose route render showed the
saved draft, or whose island never rendered it (H13).

A page or tool that wants to tell an editor "the preview is current" has had
to combine those counters itself, and it could not attribute them: a route
refresh lands for whichever revision is current when it returns (ADR 0004
§4d), and the counters are cumulative.

## Decision

### 1. One state per accepted revision

The runtime keeps a small ledger for the revision in flight and derives its
state from facts it already has:

- `pending`: work is outstanding: the merge, scheduled writes, a fragment
  render, a route refresh in flight or held back by its window.
- `current`: nothing is outstanding and nothing fell short. Writes the
  visibility gate holds for off-screen elements count as landed: they apply
  before the element is seen, and the ledger reports their number.
- `partial`: nothing is outstanding, and at least one step fell short. Each
  shortfall is named:
  - `fragment`: a boundary fell back to a patch (with its id, key and code,
    among them LP0803 for an expired or refused authorization);
  - `route-saved`: the route render showed the server's view, which does not
    carry the unsaved revision (ADR 0018);
  - `route-failed`: the route refresh failed;
  - `unfaithful`: a patch fell short and was kept (`onUnfaithfulPatch` not
    `escalate`, or nothing to escalate to);
  - `unbound`: a changed field has nowhere to land and was not escalated;
  - `write`: the binding kept its previous content because a renderer threw
    (LP0603) or an attribute write was refused (LP0401);
  - `merge`: the populated re-fetch failed and the message's own values were
    used.
- `unconfirmed`: nothing is outstanding or short on the runtime's side, but
  the revision was handed to islands that have not confirmed it (§3).
- `superseded`: a newer revision was accepted before this one left `pending`.

A route outcome is attributed to the revision current when it lands, as the
refresh itself is. A later revision starts its own record; a partial
revision followed by a current one is how recovery shows.

### 2. Where it is read

`inspect().revisions.display` holds the latest accepted revision's record:
`{ revision, state, shortfalls, deferred, awaitingIslands }`. The
`revisionDisplay` event fires with the same record when a revision leaves
`pending` (including `superseded`) and again when an `unconfirmed` revision
is confirmed. Both are additive. The session counters stay as they are.

With `enableA11y`, a revision that settles `partial` is announced once in the
live region ("Preview partly updated"). That is the optional interface; a
host can build its own from the event. Removing it would not change the
state.

### 3. Islands confirm what they render

The `payload-live-preview:update` event's detail gains `displayed()`: an
island calls it once it has rendered that revision, for instance from an
effect after its framework committed. Calling it twice, late, or for a
superseded revision does nothing. Until every island the revision was handed
to has called it, the revision is `unconfirmed`, not `current`. An island
that never calls it keeps the state honest rather than wrong: the runtime
cannot see an island render.

### 4. Hooks report the revision of their data

`useLivePreviewDocument` and the Vue composable already keep the last merged
document and a status for the merge. Their snapshot gains `revision`, the
count of the message the data came from. The framework commits the returned
data in its own render; a component that must know it was painted compares
`revision` in an effect. The hooks do not share the DOM runtime's ledger:
they write no DOM of their own.

### 5. What is not a revision outcome

The startup wait for React or Vue hydration is a session state
(`inspect().hydration`), not a revision's: once it has settled it does not
change again. A route refresh a newer revision replaces never lands, so it
reports nothing.

## Alternatives

- **One boolean "complete".** It cannot say why a revision is not current,
  and a tool would still need the counters.
- **Waiting for islands by time.** A delay says nothing about whether an
  island rendered; an acknowledgement does.
- **Deriving the state in the host from events.** Hosts would repeat the
  attribution rule of ADR 0004 §4d, and each would get it slightly wrong.

## Consequences

- Additive minor API: an inspection field, an event, an island callback, a
  snapshot field and one announcement.
- A page whose islands do not call `displayed()` reports `unconfirmed`. The
  guides show the one-line call.
- Acceptance: unit tests for each state and shortfall, mixed fragment success
  and failure, route partial and failure, an expired fragment authorization,
  supersession, recovery, a delayed island acknowledgement and the hooks'
  revision; a native case in three browsers; the full chain and nightly.
