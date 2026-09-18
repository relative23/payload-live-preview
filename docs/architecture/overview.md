# Overview

The decision records answer "why is it like this" one question at a time. This
page answers "what is it" once, so the records can be read in any order
afterwards. Every concept below has a sentence saying why it exists; anything
that needed more than a sentence has a record of its own.

## Two screens and one message

There are only ever two screens: the Payload admin, where someone is typing,
and the page, which is framed by it. Nothing else is involved — no socket, no
server round trip in the common case, no shared process.

Between them goes one message, which the admin already sends and this package
does not define:

```js
window.postMessage({ type: 'payload-live-preview', data: { …the unsaved document } }, origin);
```

Two more types share the channel: `payload-document-event`, which the admin
sends on save, and `payload-live-preview-focus`, this package's own, which an
admin-side reporter posts to name the field the cursor is in. The page opens
the exchange with a `ready` handshake carrying its protocol version, and any
other type is reported as invalid and dropped. The update is still the input
that matters. Everything in this package is a consequence of taking it
seriously: it arrives from a window we do not control, dozens of times a
second, carrying unsaved values that were never validated, for a page that must
keep working for everyone who is not an editor.

Which is why the two hard questions are **may this request see a preview at
all** and **where on this page does `data.title` belong**. The five objects
below are the answers.

## The five objects

### The decision — one per request

`PreviewDecision`: did this request show preview intent, did `authorizePreview`
accept it, may the runtime be injected, and what happens to the CSP. Every
request-time adapter — Astro's middleware, Next.js, SvelteKit, Nuxt — computes
exactly this object and then applies it; the adapters differ only in how their
framework hands them a request and a response. Astro's default `inline` and
`loader` modes compute none: they inject at build time into every page, and
the runtime does not start outside a preview frame.

_Why it exists:_ four framework integrations that each decided for themselves
would be four chances to differ on the one thing that must not differ. See
[ADR 0006](0006-authorized-preview-context.md).

### The authorization — a verdict, not a boolean

`AuthorizedPreviewContext`, produced inside the package only by
`authorizePreviewRequest()`: a frozen object carrying a registry-symbol brand
(`Symbol.for`, so every entry bundle recognises it). A hand-written
`{ authorized: true }` is not one, and every privileged path checks the brand
and the freeze rather than a boolean. The brand is not a secret — its key is
exported, and code in the same process could build one on purpose — so it
stops accidents and casts, not code that already runs inside the application.

_Why it exists:_ intent is a query parameter, and a query parameter is
something a visitor types. Draft content, binding attributes and the runtime
itself are gated on the verdict, never on the intent. See
[ADR 0006](0006-authorized-preview-context.md) and
[authorization.md](../authorization.md).

### The binding — an element that names a field

An element carrying `data-payload-field="hero.title"`, plus the companions that
say how to write it (`data-payload-type`, `data-payload-format`,
`data-payload-owner`, …). It is markup, not registration: the page states what
it can show, and the runtime finds it.

_Why it exists:_ the alternative is a component that re-renders, which means
losing focus, scroll and every uncommitted keystroke inside it. A binding is
the smallest unit that can be updated without disturbing anything around it.
See [bindings.md](../bindings.md).

### The strategy — how an update reaches the page

Three, and a page may use all three at once:

| Strategy   | What it does                                                     | When it is the right one                                                  |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `patch`    | writes the value into the bound element                          | the default: a field the page already prints                              |
| `fragment` | asks the server to re-render one marked subtree and morphs it in | markup that has to be _computed_ — a conditional section, a derived count |
| `route`    | re-renders the whole route                                       | a change nothing on the page binds, or one in `<head>`                    |

_Why three:_ patching alone cannot create markup that was never there, and
re-rendering the route for every keystroke is the thing this package exists to
avoid. Each strategy is the cheapest one that can still be correct for its
case. See [ADR 0011](0011-fragment-protocol-and-abuse-model.md) and
[hybrid.md](../hybrid.md).

### The runtime — one source, several deliveries

One source (`src/core/runtime.ts`) becomes the runtime at build time, twice:
the full artifact and a lean one with optional features left out. The
bootstrap (`src/core/loader.ts`) and the fragment and route preludes
(`src/fragment/inline.ts`, `src/fragment/route-inline.ts`) are entries of their
own, built beside it by `scripts/build-runtime.ts`. What differs is delivery:
inlined into the response, or fetched as a content-hashed asset the browser may
keep for a year.

_Why it exists as one source:_ two runtimes would be two behaviours, and the
difference would surface as a bug in whichever one a given site happened to
have. The lean artifact is the same source with branches folded out, not a
second implementation. See [ADR 0001](0001-single-source-runtime.md),
[ADR 0012](0012-package-topology-and-delivery-profiles.md) and
[what a public visitor pays](../deployment.md#what-a-public-visitor-pays).

## Everything else, one line each

The concepts that are not objects but rules. Each is here because something
went wrong without it.

- **Revision and generation** — every update carries the attachment generation
  it belongs to and a monotonic revision. A slow re-render must not overwrite a
  newer keystroke, and a stopped client must not finish work.
  [ADR 0004](0004-revision-and-cancellation.md)
- **Per-instance isolation** — every stateful primitive is a class, and
  runtime, event, plugin and cache state stays per instance. Module scope
  keeps named exceptions: three DOM-keyed `WeakMap` leases (the highlight
  plugin's style and class, the announcer's live region), the realm-wide
  Lexical, block and field renderer registries, the process-wide sanitizer
  default for direct callers, and caches that hold no update state (`Intl`
  formatters, the Trusted Types policy, once-only warnings). Two previews on
  one page, or a test suite, must not share an update.
  [ADR 0002](0002-per-instance-isolation.md)
- **Leak discipline** — DOM-keyed metadata lives in weak collections and
  active-work state is bounded and cleared on stop. A preview session is long
  and a document is edited thousands of times.
  [ADR 0003](0003-memory-leak-discipline.md)
- **Plugin resource scopes** — each registration owns its listeners and
  observers, staged until `init()` resolves and released with the plugin. A
  plugin that leaks outlives the client that created it.
  [ADR 0005](0005-plugin-resource-ownership.md)
- **Keyed morph** — a conservative morph that never enters islands,
  `contenteditable`, or a subtree a consumer owns. Reordering a list must keep
  the DOM nodes; anything else must be left alone.
  [ADR 0008](0008-keyed-morph-ownership.md)
- **Protocol capabilities** — what a peer can do is decided by the version it
  announces or by what the wire actually shows, and Payload-specific behaviour
  sits behind a profile. Payload does not version its message; we must not
  guess. [ADR 0010](0010-protocol-capabilities-by-observation.md)
- **Defaults profiles** — `defaults: 'v2'` is the current table and
  `defaults: 'v1'` restores the 1.x one in a single option, so a migration is
  staged rather than attempted all at once.
  [ADR 0007](0007-v2-defaults-and-renames-ledger.md)
- **The renames ledger** — every rename, move and re-default is one row, and
  `pll migrate` is generated from it. A migration guide nobody can execute is a
  migration nobody performs.
  [ADR 0007](0007-v2-defaults-and-renames-ledger.md)
- **The Astro peer range is what CI runs** — `peerDependencies.astro` covers
  exactly the majors the matrix installs, and the README table is rendered
  from the record. A range wider than the tests is a promise nobody checked.
  The other framework peers are open lower bounds (`react >=18`,
  `svelte >=5`, `vue >=3.3`). CI runs the React and Vue suites at the floor
  each range names — 18.0.0 and 3.3.0, installed over the lockfile by the
  `hook-matrix` job — and at what the lockfile installs, React 19 and Vue 3.5;
  `compat:check` holds the floors against the ranges. Svelte is mocked in the
  SvelteKit fragment suite, so its floor is not measured and only the
  fixture's 5.x is.
  [ADR 0009](0009-astro-peer-range.md)
- **Reproducible release** — only the artifact a certified CI run produced is
  published, byte for byte, and a rerun reconciles rather than repeats.
  [ADR 0013](0013-release-pipeline.md)
- **Auto-binding** — with `autoBind: 'unique'`, a scalar whose value is the
  whole content of exactly one element on the connection's first message is
  bound to it and marked `data-payload-guessed`; no match or several bind
  nothing, and the default is `'off'`. A unique but wrong guess rewrites
  unrelated markup while the editor types.
  [ADR 0014](0014-auto-binding.md)
- **First write after hydration** — on a page the Next.js or Nuxt adapter
  declares hydrated, the runtime starts only once React has committed a root
  holding a binding or Vue has mounted an app around one, and after five
  seconds regardless (`LP0607`). React throws away a write that came first
  together with the server markup; Vue reverts it.
  [ADR 0015](0015-first-write-after-hydration.md)

## Where the code is

| Directory         | What lives there                                                                   |
| ----------------- | ---------------------------------------------------------------------------------- |
| `src/core`        | the runtime: bindings, updates, morph, strategies, the lifecycle                   |
| `src/adapters`    | one per framework, plus `shared/` — the decision and the response glue             |
| `src/dsl`         | `bind()`, `createPreviewBindings()`: attributes as values, typed by path           |
| `src/security`    | CSP, sanitizing, Trusted Types, tokens, the authorization strategies               |
| `src/types`       | the leaf: protocol shapes, defaults profiles, the authorized context and its brand |
| `src/inline`      | generated: the runtime and preludes as strings the adapters embed                  |
| `src/codegen`     | types and the inventory from a Payload config, and the annotator                   |
| `src/fragment`    | the browser half of the fragment and route strategies                              |
| `src/plugins`     | the plugin manager and the built-in plugins                                        |
| `src/client`      | `LivePreviewClient`, and the admin-side focus reporter                             |
| `src/server`      | `definePreview()` and the privileged `./server` barrel                             |
| `src/field-types` | the built-in field renderers and their registry                                    |
| `src/lexical`     | the Lexical renderer, with the node and block registries                           |
| `src/schema`      | `fieldSchemaJSON` validation and lookup (Payload 2.x), the array and blocks diff   |
| `src/detection`   | frame and popup detection, trusted admin origins, the initial locale               |
| `src/events`      | the per-instance event emitter and the event map                                   |
| `src/payload`     | `buildLivePreviewUrl()` for `payload.config.ts`                                    |
| `src/doctor`      | `pll doctor`: probe a deployment and analyze what it serves                        |
| `src/migrate`     | `pll migrate`: the 1.x → 2.0 codemods and their runner                             |

The layering is a gate, not a convention: `scripts/architecture-rules.ts`
refuses an upward import, a runtime cycle, a Node builtin in browser-reachable
code, and a browser module importing anything server-only.
