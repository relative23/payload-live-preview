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

That is the whole input. Everything in this package is a consequence of taking
it seriously: it arrives from a window we do not control, dozens of times a
second, carrying unsaved values that were never validated, for a page that must
keep working for everyone who is not an editor.

Which is why the two hard questions are **may this request see a preview at
all** and **where on this page does `data.title` belong**. The five objects
below are the answers.

## The five objects

### The decision — one per request

`PreviewDecision`: did this request show preview intent, did `authorizePreview`
accept it, may the runtime be injected, and what happens to the CSP. Every
adapter — Astro, Next.js, SvelteKit, Nuxt — computes exactly this object and
then applies it; the adapters differ only in how their framework hands them a
request and a response.

_Why it exists:_ four framework integrations that each decided for themselves
would be four chances to differ on the one thing that must not differ. See
[ADR 0006](0006-authorized-preview-context.md).

### The authorization — a verdict that cannot be forged

`AuthorizedPreviewContext`, produced only by `authorizePreviewRequest()` and
carrying a brand no consumer can spell. A hand-written `{ authorized: true }`
is not one, and every privileged path checks for the brand rather than for a
boolean.

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

### The runtime — one build, several deliveries

One source (`src/core/runtime.ts`) becomes the inline script, the bootstrap and
the fragment prelude at build time. What differs is delivery: inlined into the
response, or fetched as a content-hashed asset the browser may keep for a year.

_Why it exists as one build:_ two runtimes would be two behaviours, and the
difference would surface as a bug in whichever one a given site happened to
have. See [ADR 0001](0001-single-source-runtime.md),
[ADR 0012](0012-package-topology-and-delivery-profiles.md) and
[what a public visitor pays](../deployment.md#what-a-public-visitor-pays).

## Everything else, one line each

The concepts that are not objects but rules. Each is here because something
went wrong without it.

- **Revision and generation** — every update carries the attachment generation
  it belongs to and a monotonic revision. A slow re-render must not overwrite a
  newer keystroke, and a stopped client must not finish work.
  [ADR 0004](0004-revision-and-cancellation.md)
- **Per-instance isolation** — every stateful primitive is a class; two
  DOM-keyed `WeakMap`s are the only module-scope state. Two previews on one
  page, or a test suite, must not share anything.
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
- **The peer range is what CI runs** — `peerDependencies` covers exactly the
  majors the matrix installs, and the README table is rendered from the record.
  A range wider than the tests is a promise nobody checked.
  [ADR 0009](0009-astro-peer-range.md)
- **Reproducible release** — only the artifact a certified CI run produced is
  published, byte for byte, and a rerun reconciles rather than repeats.
  [ADR 0013](0013-release-pipeline.md)

## Where the code is

| Directory      | What lives there                                                         |
| -------------- | ------------------------------------------------------------------------ |
| `src/core`     | the runtime: bindings, updates, morph, strategies, the client            |
| `src/adapters` | one per framework, plus `shared/` — the decision and the response glue   |
| `src/dsl`      | `bind()`, `createPreviewBindings()`: attributes as values, typed by path |
| `src/security` | CSP, sanitizing, tokens, the authorized context                          |
| `src/inline`   | generated: the runtime and preludes as strings the adapters embed        |
| `src/codegen`  | types and the inventory from a Payload config, and the annotator         |
| `src/fragment` | the browser half of the fragment and route strategies                    |
| `src/plugins`  | the plugin manager and the built-in plugins                              |

The layering is a gate, not a convention: `scripts/architecture-rules.ts`
refuses an upward import, a runtime cycle, a Node builtin in browser-reachable
code, and a browser module importing anything server-only.
