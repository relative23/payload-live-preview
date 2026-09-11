# ADR 0015 — The first write waits for the framework that hydrates the page

**Status:** Accepted • **Date:** 2026-09-11 (written before the code; measured the same day)

## Context

The runtime is an inline script in `<head>`. It starts on `DOMContentLoaded`,
posts `ready`, and the admin answers with the document. On a static page that
is the right order: the markup is final the moment it is parsed, and the first
message may repaint every binding — Z2 measured what happens when it does not
(`examples/pure-html` shows its placeholder text for good), and Z3 built on it.

On a page a framework hydrates, the markup is _not_ final when it is parsed. The
framework's client bundle arrives later, walks the server markup and claims it,
comparing what it finds with what it would have rendered. Measured on
2026-09-11 against `examples/nextjs-payload` (`/` framed by the mock admin, a
warm dev server, times from the frame's navigation start):

| t (ms) | what happened                                                                                                           |
| -----: | ----------------------------------------------------------------------------------------------------------------------- |
|   41.8 | `DOMContentLoaded`; the runtime starts and posts `ready`                                                                |
|   49.8 | the admin's first message                                                                                               |
|   93.0 | the runtime writes `title`, `hero` (`src`, `alt`) and `body` into the server-rendered elements                          |
|  135.0 | Next appends its client chunk to `<body>`                                                                               |
|  174.1 | React attaches its fiber to the bound `<h1>` — hydration is walking the tree                                            |
|  180.3 | `Uncaught Error: Hydration failed because the server rendered text didn't match the client … regenerated on the client` |
|  180.7 | React removes the `<article>` and inserts a fresh one: `alt` is `Mountains at dusk` again, the body says `Mix of …`     |
|  500.3 | the mock admin's replay (its own workaround, dated in its source) writes the document again, onto the new elements      |

The counter-tests settle whose timing it is. An admin that never answers
`ready`: no error, hydration at 166 ms, the page stays as served. An admin that
sends once, 3 s after `ready`: no error, the write lands on the server
elements and stays. So the mismatch needs both — our write and a hydration
still to come — and it is our write that comes too early. It fires once per
page load, not once per message; React 19 discards the server DOM under the
nearest Suspense boundary and renders it again on the client, which drops
every value the runtime wrote and every element it cached. Nothing in the E2E
suite saw it, because no spec listens to `pageerror`; the four occurrences in
a full Chromium run are the four loads of `/` that receive a first message.

The same first write on the other two hydrating fixtures: Nuxt (Vue 3) logs
`Hydration completed but contains mismatches.` and repairs `alt` and the
body text back to the server's values on the same elements — a silent revert,
mended by the message the runtime's second `ready` (500 ms) provokes. SvelteKit
(Svelte 5) leaves the write alone. This record fixes React; the Vue finding is
recorded in §7 of the plan as open.

### What a runtime can and cannot know

A hydration-safe write needs two facts the runtime does not have today:
**whether** this page will be hydrated, and **when** it has been.

Neither framework says either out loud. Next sets `window.__NEXT_HYDRATED`
only under `process.env.__NEXT_TEST_MODE` (`next/dist/client/app-index.js`,
16.3.0) — a test hook, not a signal a production page gives. React 19 has no
event for a completed hydration; the only public place that runs after it is a
client component's effect, and a component is something the host mounts, not
something an inline script has.

What React does expose, deliberately and since React 16, is its instrumentation
protocol: when `react-dom` evaluates it looks for
`window.__REACT_DEVTOOLS_GLOBAL_HOOK__`, calls `hook.inject(internals)` if the
hook says `supportsFiber`, and from then on calls
`hook.onCommitFiberRoot(rendererId, root)` after every commit, each call
guarded by `typeof … === 'function'` and a `try/catch`. React DevTools, and
every profiler built beside it, read commits this way. It is not a hydration
API, but a commit is the moment React has taken the tree over, and the first
commit whose root holds our bindings is the moment before which nothing may be
written. The probe, run inside the same measurement:

| t (ms) | hook call                                                                                                             |
| -----: | --------------------------------------------------------------------------------------------------------------------- |
|   74.8 | `inject` — React has evaluated, 27 ms **after** the first message: the runtime cannot learn "React is coming" in time |
|  119.8 | `onCommitFiberRoot`, container `NEXTJS-PORTAL` (Next's dev overlay owns a root of its own; no binding inside), ×3     |
|  149.3 | `onCommitFiberRoot`, container `#document`, holds the bindings — hydration committed (here: failed and regenerated)   |

Two things follow. "Whether" cannot be observed in time and has to be
**declared** by whoever emits the script. "When" can be observed, but only if
the observer is in place before `react-dom` evaluates, and only if it ignores
roots that do not hold a binding — the dev overlay's commits come first.

### Why the alternatives do not reach the goal

- **Z2's half-step, "the first message writes nothing"**, is right for this
  page and wrong for every static one. Measured and refused on 2026-09-07; the
  decision then was to leave the first write alone, and it stands.
- **A client component that signals "hydrated"** from the package's `react`
  entry is the public-API answer, and Payload's own hook works this way. It
  needs the host to mount a component, so the Next recipe and the fixture
  change, and it cannot be made automatic: `<LivePreviewScript />` is a server
  component and a bundler turns a `'use client'` module into a client reference
  only along a static import the adapter entry must not carry.
- **Polling for React's `__reactFiber$…` expando** on a bound element sees the
  render phase, not the commit: in the measurement above the fiber was attached
  6 ms before the mismatch was thrown. A write in between is still too early.
- **The `load` event** is not ordered against hydration. On `/reveal`, `load`
  fired at 126 ms and the fiber arrived at 147 ms; with streaming and Suspense
  the gap can be seconds.
- **Holding the messages instead of the start** buys nothing over holding the
  start: the admin answers `ready`, so a runtime that has not said `ready` has
  no message to hold. And it keeps state a start that has not happened does
  not need.
- **Writing again after the framework reverts** — the cache rebuild already
  notices the regenerated elements — mends what the visitor sees but not what
  React saw: the mismatch, the error in the console and the client render of
  the segment happen all the same. It is the right shape for a framework that
  repairs silently (Vue) and is left open for it.

## Decision

### 1. The adapter declares hydration; the option is knowledge, not configuration

`InlineScriptConfig.hydration?: 'react'`, wire slot 23, appended. The Next.js
adapter sets it on every script it emits — `livePreviewScriptProps()`,
`renderLivePreviewScript()`, `<LivePreviewScript />` and the middleware — because
a Next page is a React tree and there is nothing a project could configure
about that. It is not a member of `PreviewAdapterOptions`: the Astro, SvelteKit
and Nuxt adapters do not set it, and a page built by hand with
`generateInlineScript()` may. An omitted slot means what it meant, so a script
generated before the option existed keeps its behaviour.

The value names the framework and not a boolean, because the observation in §2
is React's. A second framework gets a second value and a second observer, or
none; `true` would promise a generality the runtime does not have.

### 2. Hydrated means: React committed a root that holds a binding

The runtime arms the instrumentation hook before React can evaluate: in inline
delivery it is itself the first script in `<head>`; in asset delivery the
runtime arrives as a fetched asset that may land after `react-dom`, so the
generator emits a second build of the bootstrap (`src/core/loader.ts` with
`__REACT_BOOTSTRAP__` defined) that arms before it fetches — one script in place of the plain one, not a
prelude ahead of it, so the bootstrap stays the fraction of the runtime the
delivery budgets hold it to.

Arming installs `__REACT_DEVTOOLS_GLOBAL_HOOK__` when there is none — an object
with `supportsFiber: true`, a `renderers` map and an `inject` that files each
renderer under its own id, which is what Fast Refresh walks when it attaches
(a hook without the map stopped the fixture from hydrating at all, measured)
— and wraps `onCommitFiberRoot` on the hook that is there, calling the
previous function first so React DevTools keeps working. The wrapper settles once, on the first
commit whose `root.containerInfo` is a `Document` or contains an element with
`data-payload-field`. A root without a binding — the dev overlay's portal, a
widget — is not ours to wait for. The state lives on one named `window` slot
so the bootstrap and the runtime, two bundles, share it: the bootstrap only
records the containers React committed into, and the runtime, which alone
knows what a binding is, judges the backlog when it subscribes and every
commit after — so the armed bootstrap stays within the bytes a bootstrap is
allowed.

### 3. Until then the runtime does not start

`start()` already defers to `DOMContentLoaded` while the document is loading.
With `hydration: 'react'` it defers once more, to the commit: no cache is built,
no listener attached, no `ready` posted. The admin therefore sends its first
document after hydration, and the first write lands on the elements React
owns and keeps. This is the order Payload's own `useLivePreview` produces —
subscribe in an effect, after mount — reached without a component.

A message that arrives before the start is dropped, as one before
`DOMContentLoaded` is today; `ready` is what asks for the document, and it is
re-posted at 500, 1 000 and 2 000 ms for an admin that missed the first.

### 4. A cap, said out loud

If no qualifying commit comes within `HYDRATION_WAIT_CAP_MS` (5 000 ms) the
runtime starts anyway and reports **LP0607** once through `warn`. A page whose
React never commits is a broken page, and a preview that never connects would
hide that behind this package; a preview that connects five seconds late and
says why does not. `inspect().hydration` reads `{ mode, state }` with `state`
one of `idle`, `waiting`, `committed`, `timed-out`, so "why is the preview
not connected yet" has an answer on the console.

## What counts as failure

Named here so the answer is not negotiated after the code exists.

**F1 — a false positive: the flag is set and React never commits.** A Next page
whose client bundle fails to load, or a hand-written script that set the option
on a page without React. The preview waits the whole cap.
_Measured by:_ a unit test with fake timers — the runtime starts at the cap,
LP0607 once, `inspect().hydration.state === 'timed-out'`; and nothing else
changes: the same writes land, later.

**F2 — the observer is armed too late.** React evaluated before the hook
existed: `inject` is never called, the commit is never seen, and F1's cap is
what happens. Inline delivery cannot arm late — the script is in `<head>` and
React's chunk is appended to `<body>` later (135 ms against 28 ms above).
Asset delivery can, which is why its bootstrap is the armed build.
_Measured by:_ the loader test runs the generated bootstrap and asserts the hook
is in place and the runtime appended; the asset E2E still patches.

**F3 — a root that is not ours settles the wait.** Next's dev overlay commits
three times into `NEXTJS-PORTAL` before the app hydrates. Without the container
rule the runtime would have started at 119.8 ms and written at ~150 ms, into
the middle of hydration.
_Measured by:_ a unit test commits a root whose container holds no binding and
asserts the runtime is still waiting; the E2E test below runs against the dev
server, overlay included.

**F4 — another tool replaces the hook after us.** A later script that assigns
its own `__REACT_DEVTOOLS_GLOBAL_HOOK__` object drops our wrapper; the commit is
not seen; F1's cap applies. The React DevTools extension is the other order —
it injects at `document_start`, so it is the hook we wrap — and is covered by
the wrapping test.
_Measured by:_ the wrapping test asserts the previous `onCommitFiberRoot` still
runs with its arguments; the replacement case is the cap.

**F5 — the preview connects later than it did.** By construction: the first
write moves from before hydration to after it. On the fixture that is the
distance from `DOMContentLoaded` to the qualifying commit, 105–115 ms on a warm
dev server. On a heavy page on a slow device it can be seconds — the same
seconds Payload's hook waits, and not more.
_Measured by:_ the timeline in the E2E test's evidence, and the interaction
budgets, which must not move: no static fixture sets the option.

**F6 — hydration slower than the cap.** The runtime starts at 5 s, writes, and a
hydration that completes afterwards regenerates the tree — exactly today's
behaviour, once, and now with LP0607 beside the React error to explain it. The
cap is a floor under a broken page, not a promise about a slow one.

**F7 — a static page waits in vain.** Only if something set `hydration:
'react'` on it. No adapter but Next does, `generateInlineScript()` defaults to
unset, and the four static fixtures and the interaction budgets prove the
default: they must measure byte-for-byte what they measured before.

## The default, decided

`hydration` is **unset** everywhere except in what the Next adapter emits. Not
a user-facing option in any adapter, on purpose: the plan's rule for this
task was "no adapter option; if anything, a guard on the timing that only
applies where hydration happens", and an adapter that knows its framework is
the only party that can apply it without asking.

Vue is not covered by this record. The measured revert on Nuxt is silent and
already mended by the second `ready`; whether Vue gets a value of its own
(`__VUE_DEVTOOLS_GLOBAL_HOOK__` is the analogous seam, `app:mounted` the Nuxt
hook) or the write-again shape from the alternatives is a later decision with
its own measurement.

## Consequences

- A Next preview connects after React has hydrated and never writes into a
  tree React has yet to claim. The `Hydration failed` error the fixture logged
  on every framed load of `/` is gone, and the mock admin's replay loop is no
  longer what keeps the preview correct.
- The runtime carries one more thing it reads from the page: React's
  instrumentation protocol, not a documented hydration API. That is the price,
  and the seven failure modes above are how it is kept visible. If React ever
  gives a hydration signal a script can subscribe to, §2 is replaced by it and
  §1, §3 and §4 stand.
- The runtime defines a global on pages that declare hydration and had no
  React DevTools: `__REACT_DEVTOOLS_GLOBAL_HOOK__`. React then omits its
  "Download the React DevTools" console line on those pages; nothing else in
  React reads the hook beyond the calls named in §2.
- The Next adapter's script grows by the bytes of the wire slot in inline
  delivery, and the bootstrap by the arming in asset delivery (431 → 743 B).
  The delivery budgets move by exactly that and say so.
