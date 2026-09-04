# ADR 0004 — Revision and cancellation semantics

**Status:** Accepted • **Date:** 2026-08-12

## Context

One live-preview update crosses several independently asynchronous boundaries:
preview-token validation, optional server data merging, `beforeUpdate` handlers,
debouncing, animation-frame scheduling, and off-screen replay. Completion order at
any one of those boundaries is not necessarily message-arrival order. Timer or
network cancellation alone is not a correctness guarantee because a promise may
already be settled, a callback may already be queued, or an injected implementation
may ignore an `AbortSignal`.

The runtime therefore needs one ordering model from accepted message ingress through
the last DOM write. It must also distinguish work from different listener
attachments so that detaching, reattaching, or destroying a runtime cannot let an
old continuation affect the new lifecycle.

## Decision

### 1. Work identity is an attachment generation plus a revision

Every active `MessageBus` attachment has a monotonically advancing generation. An
idempotent `attach()` while already attached keeps the current generation; a real
detach invalidates it, and a later attach starts a new one. The generation is the
lifecycle validity domain for every continuation created while that attachment is
active.

Within a `MessageBus` instance, each origin-accepted, shape-valid
`payload-live-preview` message that contains update data receives the next monotonic
revision before token validation begins. Invalid messages and data-less ready
handshakes do not consume an update revision. A rejected token may therefore leave a
gap; revision continuity has no semantic meaning. A revision is ordering metadata,
not proof of authentication or authorization.

The pair `(generation, revision)` is the identity propagated through validation,
merge, hooks, scheduling, rendering, replay, and lifecycle events. Revisions are not
reused after a generation change.

The bus captures the generation before reading a `MessageEvent`. Event properties,
message objects, origin matchers, token validators, schema parsing and handler lookup
are all JavaScript trust boundaries: accessors, proxies or callbacks may synchronously
detach the bus or advance its generation. Ingress therefore rechecks the captured
generation after each boundary and stops without queueing, dispatching or diagnosing
the obsolete message when it changed. Origin approval is scoped to the generation in
which the matcher returned; it cannot authorize continued work in a generation that
the matcher itself created reentrantly.

Update `data` is runtime-accepted only when it is a plain record. Ordinary objects,
cross-realm ordinary objects and null-prototype dictionaries remain compatible;
arrays and branded instances such as `Date` or `Map` are rejected as malformed.

### 2. Token outcomes commit in message-arrival order

Validator calls may return either a boolean or a promise. All results are normalized
onto one ordered commit path for the current generation, including synchronous
approval, synchronous rejection, thrown errors, promise fulfillment, and promise
rejection. Consequently, a synchronous verdict for message B cannot commit ahead of
a pending asynchronous verdict for earlier message A.

Detaching invalidates the current commit path. Settling a validator from an obsolete
generation produces neither an update nor an invalid-message callback. A reattached
bus has a fresh path and does not wait for unresolved validators from the prior
attachment.

The origin policy is checked fail-closed both at ingress and again at the ordered
commit boundary. When the policy has narrowed, an untrusted queue head is removed
before waiting for its token result so it cannot block later trusted work. A matcher
exception is equivalent to rejection. Consumer callback exceptions are isolated as
well: `onUpdate`, `onDocumentEvent`, and diagnostics cannot unwind the window
listener or stop the validation queue from draining.

The ordered queue advances an index rather than shifting its backing array. A fully
drained or invalidated generation drops the array immediately; long partially drained
backlogs compact only after a substantial consumed prefix. Dequeue is therefore
amortized O(1), so an adversarial async-validation backlog cannot turn arrival-order
correctness into quadratic main-thread work.

### 3. The newest accepted revision is the only current revision

A revision becomes accepted only when its ordered token outcome approves it, or
immediately on the ordered path when no validator is configured. Rejection consumes
its revision but does not supersede the latest accepted update.

Accepting a newer revision makes every older revision in that generation obsolete
before merge or hook work for the new revision begins. Pending merge continuations,
`beforeUpdate` continuations, debounce buffers, queued animation frames, and
visibility-replay entries from older revisions must not schedule or apply work.

Every asynchronous continuation and every DOM/event side-effect boundary checks both
parts of its captured identity against the active generation and latest accepted
revision. `AbortController`, timer cancellation, and queue clearing are retained as
resource-saving optimizations, but these identity checks are the source of
correctness.

Renderer resolution, attribute writes, and renderer invocation are reentrant
boundaries even though their APIs are synchronous. The lifecycle rechecks identity
after each one. A callback may finish its current JavaScript stack, but once it has
accepted a newer revision it cannot publish an element event, a stale renderer
error, or a successful flush for the superseded revision.

The renderer contract itself remains synchronous in 1.x. Structural-array patches
therefore mutate the DOM inside the renderer call; a native View-Transition callback
cannot own an authoritative write because browsers may invoke it later. This keeps
the scheduler's applied count and `afterUpdate` truthful and prevents a transition
callback captured before `destroy()` from writing afterwards.

Applied counts describe writes, not merely renderer calls. The public 1.x renderer
and scheduler callback types remain `void`, so existing custom callbacks may return
incidental values without changing behavior. A package-internal weak marker lets
known built-ins reserve exact `false` for deliberate no-write paths (invalid media,
unsupported values, protected structured text, or unrenderable structural markup).
Unmarked custom/plugin callbacks remain successful even when JavaScript happens to
return `false` after a real mutation.

Structural reconciliation owns one per-container snapshot containing values,
template metadata, and direct-child keys. The DOM key snapshot seeds the first SSR
update and detects later host replacement; template changes force a synchronous
render even for identical data. One recursive plan materializes every required
sanitized root before the first live mutation, so an unrenderable item at any depth
cannot partially change the old tree or diff memory. Slots that remain recursively
managed retain their container identity while their sanitized attributes and
nested-template metadata come from the new template and recurse under the same
rules. If a new slot removes or empties its nested template, its preflighted static
subtree is authoritative and the old managed subtree is not transplanted. Rendered
roots are parsed with their container's `ownerDocument`, keeping DOM creation in the
runtime root's realm rather than an unrelated browser global.

### 4. Each revision owns a stable data and render-context snapshot

After optional server merging, the lifecycle creates the
`PayloadLivePreviewData` snapshot for that revision. Merge failure may select the
existing raw-data fallback, but the selected fields, locale, schema, collection or
global identity, and derived render context remain associated with that revision.
Later messages must not change the context observed by an older continuation.

`beforeUpdate`, field-value resolution, plugin transforms, attribute writes,
renderer dispatch, scheduler entries, and `afterUpdate` all use that same snapshot.
Per-binding transformed values are stored with their scheduled entries; they do not
rewrite the revision's source data snapshot. Element-local locale metadata selects
both the field's locale-suffixed value and renderer locale independently for each
binding; sibling `href`/`src`/`alt` paths use the same prototype-safe dotted-path
resolver as primary fields.

### 4a. One changed set per revision, computed once

Every message carries the whole document, so "what changed" is not what the
message names — it is the diff against the previous message. That diff is
computed once, when the revision is accepted, and is the single input to
everything downstream: which fields a fragment or route strategy is asked to
plan for, which dependents `dependencies` invalidates, which bindings
`skipUnchanged` may skip, and which field the reveal option scrolls to.

Each of those had grown its own notion of "changed" and they disagreed. The
strategies were handed `Object.keys(data.fields)` — the whole document on every
keystroke — so a page with fragments re-rendered every boundary server-side per
keystroke and asked for a route refresh, which the loop guard then reported as
a failure. Meanwhile the dependency diff advanced its own snapshot as a side
effect, so calling it twice for one revision (which the route path does)
returned an empty set the second time and silently dropped every dependent.

A revision therefore carries `touched` (changed ∪ invalidated) and
`invalidated`, and the identity of each value is computed once and travels with
the scheduled write instead of being recomputed per consumer.

### 4b. A route refresh invalidates what "last applied" means

`skipUnchanged` remembers the identity of the value each element last applied.
A route refresh re-renders the page from the _saved_ document while keeping the
live nodes, so those elements now show saved values under identities that claim
the unsaved ones. The re-apply that follows the refresh would then skip every
field except the one just edited, reverting the editor's other unsaved changes.
The refresh therefore drops that memory wholesale; the same applies to any
morph the runtime itself performs.

### 5. Cancellation is revision-local and terminal

`beforeUpdate` handlers continue to run sequentially in registration order. The
`cancel()` function captures only the identity of the event that supplied it. Once
called, that revision cannot be scheduled or revived by a later handler. Cancellation
of an older revision cannot cancel, clear, or otherwise alter a newer revision.

The lifecycle uses a guarded sequential event-dispatch path that rechecks the active
identity and cancellation state before and after every handler. If a handler awaits
while a newer revision is accepted, no later handler is invoked for the obsolete
event. Once-handlers are claimed only when an eligible dispatch reaches the once
phase; after they are claimed, the snapshot remains consumed according to normal
once semantics.

The same continuation guard applies to `elementUpdate`, `afterUpdate`, and
revision-owned renderer-error dispatch. A handler that starts while its revision is
current may run, but synchronous or asynchronous re-entry that accepts a newer
revision prevents every later handler in the old event snapshot from running.
For each binding, the runtime determines whether `elementUpdate` is observed before
reading the pre-render DOM snapshot or invoking its renderer. A listener registered
reentrantly by that renderer therefore starts with the next binding write; this keeps
the event's `previousValue` truthful and avoids an otherwise unconditional DOM read
on the normal listener-free path.

After all handlers settle, the lifecycle schedules the revision only if it is not
cancelled and its identity is still current. A slow older handler that completes
after a newer revision was accepted is discarded regardless of its cancellation
state. Cancelled or obsolete revisions emit no successful `afterUpdate`.

### 6. Scheduler batches are homogeneous and newest-wins

Every scheduled entry carries its work identity, the stable data/context snapshot,
and its per-binding value. A pending batch contains entries from exactly one current
revision. Advancing to a newer accepted revision discards all older pending and
replay entries before accepting new entries; entries from different revisions are
never combined into one flush.

Within the same revision, repeated writes for one element coalesce to the latest
entry. A flush therefore reports the one revision and data snapshot that produced
its writes, rather than reconstructing event data from mutable lifecycle state.

An off-screen entry retains that same identity and snapshot. It may replay only while
its generation and revision are still current. Accepting a newer revision, removing
the element, detaching, or destroying the runtime removes or invalidates the replay.

A full cache rebuild replaces every `CachedElement` metadata snapshot but does not by
itself supersede update work. Pending or replay work survives only when the same DOM
element remains bound to the same field name, and is retargeted to the rebuilt
snapshot before it can apply. Removal, rebinding to another field, or changing the
element-local locale discards that element's buffered work. Locale chooses the value
and transform context before scheduling, so merely replacing the metadata would pair
old-locale data with a new-locale renderer. Thus retained work observes compatible
current binding metadata without allowing old field or locale data to cross into a
new binding.

### 7. `afterUpdate` describes an actual application batch

`afterUpdate` is emitted only when at least one still-current entry is applied through
the DOM application path. Its `revision` is the batch revision, its `data` is the real
merged-or-fallback snapshot for that revision, and its `updatedCount` counts entries
applied in that batch. A rejected, cancelled, obsolete, destroyed, or deferred-only
batch does not emit a successful `afterUpdate`.

If a flush applies visible entries and defers others, the initial event describes
only the entries applied then. A later visibility replay is another actual
application batch and emits `afterUpdate` with the same revision and data snapshot.
Consumers may therefore observe more than one `afterUpdate` for a revision when
visibility gating is active, but never one for stale replay work.

### 8. Destroy invalidates before it tears down

`destroy()` first makes the active generation and revision ineligible, then detaches
the bus, aborts merge work, cancels scheduler handles, clears pending/replay state,
and releases the remaining resources. Destruction never drains buffered DOM work.
Callbacks created before destruction may still settle, but they cannot mutate the
DOM, emit successful update lifecycle events, or affect a later attachment.

Every cancellable host callback also owns an exact published identity. Debounce and
heartbeat timers, animation frames, observer deliveries, merge attempts, and message
listeners may clear state or perform work only while their captured handle, attempt,
or generation is still current. Correctness therefore does not depend on
`clearTimeout()`, `cancelAnimationFrame()`, `AbortController.abort()`, or observer
disconnect preventing a callback that is already queued. Teardown first revokes the
owned state and only then invokes external cancellation or disconnect hooks, so a
re-entrant restart cannot be overwritten by the older cleanup stack. Resource
acquisition follows the inverse transaction: it claims a unique attempt before the
host callback and either commits that same attempt or rolls back exactly what it
registered without detaching a newer owner.

Consumer callbacks are reentrant lifecycle boundaries. Startup, heartbeat timeout,
cache rebuild, and ready-retry orchestration recheck the running state after invoking
them and before attaching listeners, scheduling timers, rebuilding a destroyed cache,
or sending another handshake. A callback that destroys the runtime therefore makes
the remainder of the current orchestration stack inert.

Diagnostic callbacks are not lifecycle boundaries. Runtime `log`/`warn` sinks and
console-backed diagnostics are invoked through one failure-isolation primitive that
contains synchronous exceptions and observes rejected Promises or thenables. Reporting
an error can therefore never replace a merge fallback, interrupt startup or rendering,
skip a later event handler, or create an unhandled rejection of its own.

Startup is a resource transaction over the deferred DOM-ready listener, observers,
cache registrations, message listener, scheduler, merger, accessibility lease, and
ready-retry timers. Inline bootstrap extends that transaction through publication of
the global owner handle: if the property cannot be defined, the already-started
runtime is destroyed before the original publication error is rethrown. A synchronous
startup failure releases every partially acquired resource before it is rethrown,
leaving the same runtime/client retryable. A failure after a deferred
`DOMContentLoaded` start is rolled back in the same way and reported through the
runtime `error` event because the original `start()` call has already returned. Once
startup succeeds, later best-effort ready retries contain transport exceptions rather
than escaping a timer callback or invalidating an otherwise healthy runtime.

## Consequences

|                                                        |                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| ✅ Deterministic visible state                         | Only the newest accepted revision in the active generation may paint                    |
| ✅ Mixed validators preserve arrival order             | A synchronous result cannot overtake earlier asynchronous validation                    |
| ✅ Teardown is race-safe                               | Promise settlement after detach or destroy is harmless even when it cannot be aborted   |
| ✅ Events are attributable                             | `afterUpdate` carries the revision and data that actually reached its application batch |
| ✅ Replay remains truthful                             | Deferred work keeps its original context and is dropped when superseded                 |
| ⚠️ Slow validation causes head-of-line blocking        | Preserving ingress order is preferred to showing causally reordered updates             |
| ⚠️ Intermediate revisions may be unobservable          | Debounce and newest-wins coalescing intentionally discard superseded work               |
| ⚠️ One revision can produce multiple completion events | Visible writes and later visibility replays are distinct application batches            |
| ⚠️ Additional metadata travels through the hot path    | The small bookkeeping cost buys explicit, testable race safety                          |

The change preserves the 1.x token-validator signature, renderer API and DOM
results, debounce defaults, visibility defaults, and existing preview-intent defaults.
Revision metadata is additive. No new authentication API or security default is
introduced by this ordering model.

## Verification

Deterministic tests control promises, timers, frames, and visibility and cover:

- asynchronous-then-synchronous token verdicts and both approval/rejection paths;
- dynamic origin-policy rejection/exception at the queue head and callback-failure
  isolation while the queue continues draining;
- synchronous generation changes from event/proxy accessors, ingress origin matching,
  validator lookup/callbacks and thenable assimilation, proving obsolete ingress
  cannot contaminate or block the fresh queue;
- plain-data validation across ordinary, cross-realm and null-prototype records, with
  branded objects rejected;
- detach during validation and detach/reattach without old-queue blocking;
- slow older merge or `beforeUpdate` work completing after a newer revision;
- re-entry during renderer resolution, renderer/attribute application, and guarded
  `elementUpdate`/`afterUpdate` handler sequences;
- revision-local cancellation with no cancellation or revival of newer work;
- single-revision and coalesced flush metadata;
- deferred replay before and after supersession;
- structural writes in a host exposing native View Transitions, proving the DOM is
  already current when `afterUpdate` runs and no deferred callback is captured;
- SSR-seeded structural reconciliation, mixed move/update patches, recursive
  template-metadata changes, owner-document creation, deep unrenderable-template
  rollback without live-tree mutation, and no-write event truth;
- pending and deferred work across cache rebuild, including metadata retargeting and
  removal/rebinding discard; and
- throwing and asynchronously rejecting diagnostic sinks across event dispatch,
  startup, merge fallback, rendering warnings, and inline bootstrap; and
- observer and ready-transport failures during immediate and deferred startup,
  including complete resource rollback, client/runtime retry, and failed global-handle
  publication without an unreachable live runtime; and
- ineffective timer/frame cancellation, stale observer deliveries, re-entrant
  teardown/restart, merge attempts started by abort listeners, and listener
  registration that throws after attaching; and
- destroy between every asynchronous stage and its side effect.

The invariant for every test is the same: obsolete work may finish computation, but
it cannot write the DOM or emit a successful `afterUpdate`.
