# ADR 0005 — Plugin resource ownership and transform ordering

**Status:** Accepted • **Date:** 2026-08-12

## Context

Plugins extend a live-preview client by subscribing to events, transforming field
values, overriding renderers, and registering other cleanup work. Those side effects
must have the same lifetime as the plugin registration that created them. Keeping only
the plugin object is insufficient: removing a plugin would otherwise leave listeners,
transforms, or renderer overrides active, and a partially failed `init()` could leak
resources that were registered before the failure.

Renderer overrides and transforms also need deterministic composition. A renderer
override must not permanently replace a renderer owned by another plugin or by the
runtime, and every update path must apply the same transform contract before writing
to the DOM.

## Decision

### Registration-local resource scopes

Every plugin registration attempt receives its own resource scope and a context bound
to that scope. The context exposes a scoped event facade rather than an ownership-free
emitter. Each `on()` or `once()` subscription is recorded with its exact unsubscribe
handle, so closing one plugin scope removes only that plugin's listeners.

The compatibility `emit()` and guarded `emitWhile()` methods delegate to the owning
client's emitter rather than an empty facade-local emitter. `emitWhile()` composes its
caller predicate with scope eligibility, so unregistering a plugin stops an in-flight
guarded dispatch between handlers; a retained closed context cannot start another.
Scope eligibility is checked both before and after invoking the caller predicate,
because that predicate may itself unregister the plugin re-entrantly.

Registrations created through the context remain staged while `init()` is pending.
Only after `init()` resolves are its listeners, transforms, and renderer layers
published synchronously as one commit. External events and updates therefore cannot
observe a partially initialized plugin. A staged `emit()` still reaches resources
that were already active, but not the registration's own not-yet-committed listeners.

The existing public `registerFieldRenderer()` and `registerTransform()` methods retain
their 1.0.x `void` return contract; the additive `registerCleanup()` method follows the
same rule. This matters for expression-bodied `init` hooks, whose inferred return type
must remain compatible with `void | Promise<void>` in a patch release. Internally, the
scope records an exact, idempotent disposer for each renderer, transform, and cleanup.
Existing event subscriptions keep their established unsubscribe return value, and
one-shot listeners remove their internal scope entry when consumed. Built-ins with
recurring short-lived resources aggregate those resources behind one
registration-owned cleanup rather than exposing a new public disposer-return API.
Once a scope has been closed, a retained context cannot register new resources.

The exported `PluginManagerOptions.registerFieldRenderer` host callback likewise
retains its 1.0.x `void` type. The built-in client bridge supplies its exact renderer
handle through an internal runtime return channel; the manager accepts only a function
from that channel and ignores other JavaScript expression results. Existing callbacks
such as `renderer => sink.push(renderer)` therefore remain type-compatible and their
numeric result can never be mistaken for cleanup work.

If `init()` throws or rejects, the manager closes the incomplete scope and rolls back
every resource already registered by that attempt. The plugin is not added to the
active registry. Normal removal also closes the resource scope before invoking the
plugin's `destroy()` hook. Each disposer and `destroy()` is error-isolated: one failure
is reported but does not prevent the remaining teardown steps. The diagnostic sink is
isolated by the same shared runtime primitive, including synchronous exceptions and
rejected thenables, so reporting one teardown failure cannot strand later cleanups.
Plugin disposers remain synchronous: an accidentally returned thenable is observed to
prevent an unhandled rejection and reported as a contract error, but is deliberately
not awaited, so teardown order and completion semantics remain deterministic.

Plugin-manager mutations normally run through one call-order queue. Awaiting arbitrary
`init()` and `destroy()` hooks while holding that queue, however, would deadlock when a
hook awaits `use()` or `unuse()`: the nested operation could never start before the
hook that is waiting for it finishes.

While any lifecycle hook is pending, requested mutations therefore use a deterministic
direct transaction path. Removal closes the target scope before running its isolated
destroy hook. Removing an initializing registration marks it cancelled, closes its
staged scope, and prevents its later continuation from committing. A nested
registration completes its own staged init and commit before the waiting hook resumes;
the child commits before its parent, and remains an independent registration if the
parent later fails. `destroyAll()` continues over the active-name snapshot it captured
at entry, while exact teardown promises deduplicate concurrent removal of one name.
The one intentional exception is redundant removal of a name from inside its own
pending `destroy()` window: its scope is already closed, so that nested call resolves
immediately instead of awaiting the promise that is itself awaiting the hook. The same
resource-complete result applies to a concurrent duplicate during that narrow window;
the original removal caller still observes completion of `destroy()`.

Browsers provide no portable async-call-chain context, so the same rule necessarily
applies to an external mutation that arrives while a hook is pending. Active and
initializing names share the duplicate check, every resource remains invisible until
its own transaction commits, and once each direct transaction resolves its observable
effect is complete. Outside this hook-pending window, normal queue serialization and
call order remain unchanged.

### Renderer layers

Renderers form a stack per field type. The built-in renderer is the base layer and
plugin registrations add layers in registration order; the last registered active
layer wins. Disposing a plugin's layer reveals the preceding plugin layer or the
built-in renderer without changing unrelated stacks. Re-registering a removed plugin
creates fresh layers and does not duplicate the old ones.

### Transform and dispatch contract

Transforms are synchronous and run in plugin registration order. For each bound
element, the pipeline first resolves the merged field value and then applies that
field's transforms while preparing the revision-bound binding entry, immediately
before scheduling it. Each transform receives the previous transform's result. The
final transformed value is stored in that entry, so debounce and visibility replay
cannot observe a later plugin registration state. Attribute binding or renderer
dispatch later consumes that stored value. `allFields` remains the merged,
untransformed snapshot for the update; it is not incrementally rewritten as individual
elements are transformed.

Transforms are re-entrant callback boundaries. If a transform synchronously causes a
newer revision to be accepted, a current-revision guard stops the rest of the obsolete
transform chain and binding loop before any further plugin callback, scheduling, or
orphan-field diagnostic for that revision.

If any transform throws or returns a Promise/thenable, the failure is reported through
the runtime `error` event, the remaining transform chain for that element stops, and
the scheduler stores the original merged field value as the fallback. The transformed
or fallback value still passes through the existing downstream attribute validation,
URL checks, renderer escaping, and HTML sanitization. Plugins cannot use a transform
to bypass those trust-boundary controls. The host's transform-error reporter is itself
a diagnostic sink: synchronous exceptions, rejected Promises, and hostile thenables
are isolated and cannot replace that fallback or escape as unhandled rejections.

## Consequences

|                                                                                                              |                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| ✅ Plugin removal restores the exact listener, transform, and renderer state that preceded that registration | Resources owned by other plugins and the runtime remain intact                      |
| ✅ Failed initialization is transactional                                                                    | Partially registered resources are rolled back                                      |
| ✅ Renderer precedence is deterministic                                                                      | Removing the active override restores the previous layer                            |
| ✅ Attribute and renderer paths share one transform contract                                                 | Both receive the transformed merged value                                           |
| ✅ Teardown is resilient                                                                                     | One failing disposer or `destroy()` hook cannot strand unrelated resources          |
| ⚠️ Plugin contexts have a finite lifetime                                                                    | Retaining a context after rollback or removal does not permit new registrations     |
| ⚠️ Transforms cannot perform asynchronous work                                                               | Revision-aware async preparation belongs in lifecycle hooks, before render dispatch |

## 2.1 addendum: runtime and navigation ownership

### Runtime sessions own what `start()` acquires

2026-09-19 (2.1): the runtime gives each session a scope of the same kind.
`start()` opens a `LifetimeScope` (`src/core/lifetime-scope.ts`: own, close in
reverse, guard each release — the form the inline runtime carries; the plugin
manager keeps `ResourceScope`, which adds staging, commit and per-kind counts
the runtime never uses) and hands it the teardown in the order it must run — the last entry closes first: the deferred start, the ready-handshake
retries, the heartbeat, the message listener, the strategies' work in flight,
the root sentinel, the observers, the scheduler, the merger. `destroy()`,
`suspend()` and a failed start all release the same way: mark the session
invalid, close the scope. A cleanup that throws is logged and the rest still
runs, as for a plugin. Two fences hold this: `tests/unit/core/session-scope.test.ts`
counts every timer, every listener on `window` and `document` and every
observer across fifty sessions and finds none left, and
`scripts/check-resource-inventory.ts` holds `quality/resource-inventory.json`
against the source — every acquisition in `src/core` (24 today) names who
releases it: the scope, the instance on `destroy()` only (the announcer's
timer, which a suspended runtime keeps), the disposer a call returns
(navigation listeners, the `__livePreview` handle) or a page-wide accessor
left in place on purpose (Vue's mount signal, ADR 0015). A new acquisition
fails the architecture gate until it is written down.

### The lifecycle binding and retained message have longer-lived owners

2026-09-24 (2.1): a committed client-router navigation is a revision boundary,
not a new runtime session. The session's listener stays attached while its
message generation advances. The inline bootstrap owns the
`bindNavigationLifecycle()` disposer outside `LifetimeScope`: it must survive
`suspend()` so a persisted `pageshow` can reacquire a session, and
`__livePreview.destroy()` removes it before destroying the runtime. Failure to
publish the global handle runs the same unbind-and-destroy rollback. A consumer
that binds a `LivePreviewClient` directly owns the disposer returned by
`bindNavigationLifecycle()`.

The one retained accepted message belongs to the `MessageBus` instance, not to
an individual `start()` scope. That deliberate exception lets the same runtime
replay after a router commit and, within the heartbeat rule below, after a
back/forward-cache suspension. It is neither module-global nor shared with a
replacement client. `destroy()` forgets it even when the runtime is suspended;
a heartbeat expiry also forgets it. A local replay does not kick the heartbeat,
so it cannot extend the remote sender's deadline.

On a persisted restore, `start()` asks `HeartbeatTimer.resume()` whether the
original deadline elapsed while the session was suspended before it attempts a
replay. An expired deadline runs timeout cleanup and prevents replay. With the
default disabled heartbeat (`heartbeatMs: 0`) there is no time-based expiry
claim; ownership then ends at explicit destroy or page/runtime replacement.

Within a live session, a confirmed navigation commit invalidates pending token,
merge, scheduled-write, fragment, and route work before rebuilding the cache.
The retained message then receives a new generation and revision. Retained
bindings are written again, auto-binding gets a new baseline search, and an
unsaved field absent from the committed route can escalate. Mutation-driven
cache rebuilds and the older public refresh methods stay cache-only.

`tests/unit/core/session-scope.test.ts` holds acquisition and release counts
across suspend, destroy, failed start, re-entrant close, and fifty sessions.
`tests/unit/core/navigation-lifecycle.test.ts` pins ownership and idempotent
unbind of page and router listeners. `tests/integration/runtime-preview-context.test.ts`
pins global-handle rollback and destroy teardown, while
`tests/unit/core/lifecycle-heartbeat.test.ts` proves an expired suspended
heartbeat is handled before retained replay.
