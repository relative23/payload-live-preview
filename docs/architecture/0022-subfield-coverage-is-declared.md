# ADR 0022 — Sub-field coverage is declared, not implied by one descendant

**Status:** Accepted • **Date:** 2026-09-29

Shipped in 2.1.0 (2026-10-23), after the full release chain ran on it.

This record adds an opt-in coverage rule and a declaration attribute. The 2.x
default does not change; flipping it is recorded as a 3.0 candidate in the
ADR 0007 ledger.

## Context

The diff that decides what a revision changed names top-level fields
(`src/runtime/core/update/field-changes.ts`). A binding usually names a path inside one:
`hero.eyebrow` for the group `hero`. So that groups do not all look unbound,
`hasBindingBelow()` makes `hero` addressable as soon as any path below it is
bound. The rule is shared by the unbound-change escalation
(`onUnfaithfulPatch`), the orphan report (LP0203) and the unbound-fields
overlay, which must answer alike.

The rule is a heuristic. A page that binds `hero.eyebrow` and shows
`hero.description` from the saved document does not escalate an edit of
`hero.description`: the top-level field `hero` is "addressable", the edit
stays invisible and nothing says so. The opposite reading is not always right
either: a page may show only the eyebrow on purpose, and escalating every
edit of the rest would cost a route refresh for nothing.

## Decision

### 1. `data-payload-covers` declares what the page accounts for

An element may carry `data-payload-covers="hero seo.title"`: space-separated
field paths the page accounts for, including everything below them. A covered
path is addressable wherever the rule is asked: no LP0203, no unbound-change
escalation, not listed by the overlay. The element's owner (the closest
`data-payload-owner`) scopes the declaration the way it scopes a binding, so
under `scopeBindingsByOwner` a declaration of another document covers
nothing. `createPreviewBindings().covers(...paths)` emits the attribute only
for an authorized response, as every other binding helper does. The attribute
is additive and honoured in both modes below.

### 1a. What a strategy renders is covered too

A fragment boundary and a route-bound element name the fields they depend on
(`data-payload-depends`). When the page configures the strategy that renders
them, those fields and everything below them are covered in the same way as a
declaration: the boundary or the route shows them. Before this record such a
field counted as unbound: an edit refreshed the whole route and then rendered
the boundary anyway, and `inspect().fidelity.fields` named a field the page
did show.

The rule is the planners' own, in one function (`renderingStrategy()`): a
boundary is any element with a non-empty `data-payload-fragment`, a binding
on it or not; a route-bound element is one marked
`data-payload-strategy="route"`, or a binding in `<head>` with no strategy of
its own. An empty fragment name, a boundary inside an island, which the
island renders, and a depends list without a strategy cover nothing. Nor
does anything when the page lacks the strategy. Owner scoping applies as for
bindings.

### 2. `subfieldCoverage` chooses how a group counts as covered

`subfieldCoverage: 'descendant'` is the 2.x default and today's rule: one bound
descendant covers the group. `subfieldCoverage: 'declared'` asks path by path.
A top-level field that is covered only through descendants is compared with
the previous message below the top level, and each changed path needs its own
binding, a binding on an ancestor inside the group, or a declared cover.
Otherwise the path is unbound: LP0201/LP0203 name it (`hero.description`), and
`onUnfaithfulPatch` escalates as for any unbound change.

The option exists on the client, the runtime, `generateInlineScript()` (new
inline slot 26, append-only) and every adapter.

### 3. The comparison is lazy and bounded

Only the declared mode compares below the top level, and only for a field that
changed and is covered solely through descendants. The walk keeps the
previous message's fields (one document, released with the next message),
stops at the first covered path, and treats objects and arrays alike (array
indices are path segments, as bindings may name them). It compares leaves
with the existing `valueIdentity`. A path that changed shape between scalar,
array and object, or went away, counts as changed as a whole, and so does a
changed node with nothing inside to compare. Past depth 8 or 1 024 visited
nodes per field the remaining subtree counts as one changed path: unbound
unless a cover or binding sits on it. That is the conservative direction: a
refresh too many, never an edit hidden. A bound rich-text or array field below
the group stops the walk at its own path, so its tree is never walked. A
property test holds the walk to four statements over arbitrary groups and
bindings: nothing covered is reported, every changed uncovered leaf is
reported at, above or below itself, an unchanged group reports nothing, and
the bounds hold. Its first runs found the two shape rules above.

### 4. The three callers keep one rule

`unboundChangedFields` (escalation, both profiles), `diagnoseOrphanFields`
(LP0203, on the document rather than the diff) and the overlay's
`unboundFieldNames` take the same mode and the same covers. The overlay reads
the mode and the configured strategies from the client configuration, and the
covers, boundaries and route-bound elements from the page.

## Alternatives

- **Conservative escalation as the default now.** It is the correct long-term
  reading, but it changes behaviour on 2.x pages without warning and adds
  network work; AGENTS' compatibility rule defers default changes to 3.0.
- **Per-group opt-in markers instead of a mode.** Authors who do not know the
  heuristic would never add them, which is how the gap stayed hidden.
- **Keeping previous identities per path instead of the previous document.**
  Identities for every path of every field cost more than one retained
  document, and a rich-text tree would hit the bound on every message.

## Consequences

- A page that sets neither the option nor the attribute changes in one case,
  as a bug fix (§1a): a field only a rendered boundary or route marker depends
  on no longer refreshes the whole route first and is no longer reported as
  unbound.
- In declared mode, an edit of an unbound sibling asks for the route or a
  fragment render (per `onUnfaithfulPatch`) and is named in the fidelity
  report. A page that shows part of a group on purpose declares the rest with
  `data-payload-covers`.
- The 3.0 ledger records the flip of the default to `'declared'`. Until then a
  page can try it: LP0203 names each uncovered path once the option is on.
- Acceptance: unit tests for the comparison (including property tests of the
  bounds), the three callers, the helper and the boundary and marker coverage
  of §1a; a native case in three browsers in
  which a partially bound group's unbound sibling refreshes the route in
  declared mode and not with a cover; the full chain and nightly.

## Addendum (2026-10-28): population is not a change

With a merge (`serverURL`), a message inside the merge window renders the
admin's own values before the server answers, and the admin posts an upload or
relationship as its id. The comparison in §3 then met the id on one side and
the document the previous answer held on the other, called the path reshaped
and escalated while the editor typed beside it (measured on a site: LP0807 and
a route refresh for a keystroke in a kicker). Two values that are equal but for
a document standing where the other holds its id now count as one. LP0203 reads
the message's own values, so it names the upload rather than the fields of its
document. `tests/unit/core/declared-coverage-population.test.ts` pins both.

## Addendum (2026-11-27): the default is `'declared'`

3.0 makes the flip the consequences above announce (ADR 0007, row 17).
`'descendant'` stays as the 2.x rule under its name, and the development
notice of 2.4 leaves with the default it named. A page that sets neither the option nor a cover now
meets the rule of section 2 as it is: the `id` of an array row or of a related
document is a changed path too, so a moved row or a switched relationship is
reported on a page that binds into it and covers nothing else.

## Addendum (2026-11-27): an `id` is a change, and not a field

The question after the flip was whether `id`, `createdAt` and `updatedAt`
should be left out below the top level as they are at it. Three variants of
the comparison ran against thirteen scenarios in the runtime, and the real
admin (Payload 3.94.2) gave the shapes: a row is `{ id, label }`, a populated
user `{ id, updatedAt, createdAt, email, sessions, collection }`.

Left out by name at every depth, three scenarios end as a full update with a
stale page: a link built from the related document's `id` that no binding
holds, and a date field an editor named `updatedAt` or `createdAt`, in a group
or in a row. The gain is small: a switched relationship still differs in every
other field of the two documents the page does not bind, and a moved row is
handed over by its own rule. So the comparison stays as section 2 has it. A
changed `id` says that another row or document stands at the path, which is
the reason `moved-rows.ts` gives for a moved row, and a page that shows a
related document in part declares it: `data-payload-covers="author"`.

What changes is the read of a document, where nothing has changed yet. With
the declared rule as the default, a page that binds its rows field by field
heard `LP0203: field "rows.0.id" has a value and no anchor` for every row, and
the overlay listed the same paths, with a block's `blockType` beside them.
Neither is a field an editor types into. LP0203 and the overlay leave out a
path that ends in a system field name or in `blockType`; the comparison of two
messages keeps it.
