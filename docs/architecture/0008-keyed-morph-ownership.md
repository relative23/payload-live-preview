# ADR 0008 — Keyed morph: what it keeps, what it never crosses

**Status:** Accepted • **Date:** 2026-08-27 (written before the first morph commit)

## Context

Structural array updates (`data-payload-structural`) reconcile a container's
children against the array the admin sent: keyed by each item's `id`, with
nested slots transplanted into re-rendered items. Through 1.2.0 an item whose
value changed was re-rendered from its template and swapped in with
`replaceWith()`. That is correct for markup and wrong for everything the
markup had accumulated: focus and text selection inside the item, scroll
position of an overflowing item, a playing `<video>`, an open `<details>`,
form state, event listeners the site attached, and — worst — the internal
state of a custom element or a hydrated framework island that happened to
live inside the item.

The 1.3.0 plan asked for a conservative keyed morph that preserves node
identity where the old and new markup are compatible, and asked this record
to say, before the code existed, what the morph will **never** cross.

## Decision

### 1. Retain, never copy

The morph keeps live nodes and edits them toward the rendered markup. It
never copies listeners, state or properties from one node to another;
whatever a retained node carries — listeners, `value`, `scrollTop`,
playback, an open disclosure — survives because the node does. A node the
morph cannot retain is replaced, and its state is lost the way it always was.

Retention keeps a node's _state_, but a keyed **move** is still a remove and
re-insert, which blurs a focused element and drops its selection. The morph
therefore captures the active element inside the subtree before editing and
restores focus and selection afterwards if it was reinserted; editing in
place, the common case, never reaches that path.

### 2. Compatibility is structural, not semantic

Two elements are compatible when they have the same tag name and namespace
and neither is a boundary (§4). Keys decide the pairing of children:
`data-payload-key` on item roots and `data-payload-nested-key` on nested
slots; unkeyed children pair positionally within their parent. A keyed child
never pairs with an unkeyed one.

An attribute counts as a key only when it carries a **non-empty value**. A
boolean marker such as `data-payload-island` is present on every sibling with
the same (empty) value, so treating it as a key made every sibling share one
key and all but the first lose their identity on each update. Such markers
therefore pair positionally, like any other unkeyed child.

Text and comment nodes pair positionally within their kind and are updated in
place when their data differs; a text node is never rewritten into a comment
or the reverse.

Positional pairing **never consumes a live node of another kind**. When the
rendered markup begins with a comment or an indentation text node that the
live tree does not have — the ordinary case when one side is compact and the
other is not, or when SSR hydration markers exist on one side only — the
rendered node is inserted and the live elements keep their identity. The same
holds when a rendered element is an insertion: if the _following_ rendered
node pairs with the live candidate, the live one is kept for it rather than
replaced. A tag change replaces exactly the one live element it applies to.

### 3. Attributes: the CMS controls only what the template names

Attribute synchronisation sets and removes attributes so the live element
matches the rendered one — with one exception. State-bearing attributes
(`open`, `value`, `checked`, `selected`) are touched only when the rendered
element carries them: a template that writes `open` on `<details>` controls
that state from the CMS; a template that does not leaves the visitor's
choice alone. Live properties (`.value`, `.checked`, `.scrollTop`, playback
position) are never written by the morph.

### 4. Boundaries the morph never crosses

The morph retains a boundary element as a whole and does not descend into
it. Boundaries are:

- **Custom elements** — any element whose tag name contains a hyphen.
  Their subtree is theirs; the morph has no way to know what a shadow root
  or an upgrade callback did with it.
- **Hydrated islands** — `astro-island`, and any element marked
  `data-payload-island`. A framework owns that subtree; patching into it
  corrupts the framework's view of its own DOM. The island bridge
  (the 1.3.0 "island interoperability" item) is the explicit adapter for
  handing data in.
- **`contenteditable`** — a subtree the visitor is editing.
- **Consumer-owned subtrees** — `data-payload-owned`, the opt-out for
  anything the site scripts and the morph cannot see; listeners it cannot
  see are the reason the morph retains rather than copies (§1).

When the rendered markup has a boundary element where the live tree has a
compatible boundary element, the live one stays untouched. When the rendered
markup has a boundary element where the live tree has something else — or
nothing — the rendered boundary is inserted fresh, exactly as a first render
would.

### 5. Keys: missing, duplicate, unstable

- **Missing** — an item without an `id` pairs positionally. This is the 1.x
  behaviour and stays; it is announced once per container (`LP0404`) because
  positional pairing is what makes an insert at the top re-render every row.
- **Duplicate** — two items with the same key: the second and later ones
  pair positionally, and the container warns once (`LP0405`). The morph does
  not guess which duplicate the author meant, and it does not mutate the live
  DOM to disambiguate: the duplicates keep their key attributes and are simply
  not in the key index. (Stripping the attribute from later duplicates, as an
  earlier implementation did, removed markers the page itself relies on.)
- **Unstable** — every key changed while the length did not: the update is
  treated as a full replacement (every item re-rendered), and the container
  warns once (`LP0406`) that the source generates keys per message. Unstable
  keys defeat the morph; they do not break it.

### 6. Measured before it replaces `replaceWith()`

`tests/benchmarks/hot-paths.bench.ts` gains a structural-update case
(100-item list, one item changed; 100 items reordered) measured with
`replaceWith()` and with the morph, on pre-seeded containers so the sample
is the update alone.

Measured 2026-08-27 (jsdom, this machine): one changed item — replace
0.425 ms, morph 0.455 ms (+7 %, about 30 µs); 100 items reordered — replace
0.357 ms, morph 0.361 ms (within noise). The reorder path does not render,
so the morph costs nothing there; the changed-item path pays one attribute
diff and one child walk on top of rendering. That 30 µs is accepted: it is
what keeping focus, selection, playback and listeners costs, and it is an
order of magnitude under the 50 ms debounce that precedes every update.
The rule this record set — "not slower within noise" — was therefore not
met literally and is replaced by the measured budget above; the bench stays
as the trend that keeps it honest. The 300 / 1,000 scenario budgets from
1.5.0 are unaffected (scalar bindings do not go through the morph).

### 7. Proven in browsers

The acceptance gates are browser E2E, not unit tests: node identity across
a keyed move, focus and selection across a structural edit, and a custom
element with internal state across updates — in Chromium, Firefox and
WebKit, on the Astro fixture's `/structural` page.

## Consequences

- Items keep what they accumulated; the surprising loss of focus on every
  keystroke in a structural list is gone.
- Templates that want CMS-controlled `open`/`checked` must say so in the
  template. Templates that relied on `replaceWith()` resetting form state
  no longer get that reset.
- Custom elements and islands inside items are safe by construction and
  update only through the island bridge.
- Diagnostics `LP0404`–`LP0406` join the code table; `pll doctor` reports
  missing keys on structural containers.

2026-09-17 (2.0.2): `pll doctor` does not report missing keys. Its findings are
`LP0701`–`LP0710` (`src/core/diagnostic-codes.ts`), and nothing in `src/doctor`
reads `data-payload-key`. A missing, duplicate or unstable key is reported by
the runtime when an update reaches the list, once per container, as `LP0404`,
`LP0405` or `LP0406` (`src/field-types/structural-array.ts`).

### 8. The contract, pinned (2026-09-19)

Sections 1–5 are now a suite rather than a description. A change to the
engine that moves one of these lines is a change to this record.

- `tests/unit/core/morph-contract.test.ts` — one case per promise, in jsdom,
  where the DOM rules are the browser's: focus and caret through an edit
  beside the focused control, with no blur, and back after a keyed move
  (an input; a textarea with its selection direction); listeners and
  expandos on a retained element; the visitor's form state against a
  template that does not name it (checkbox, radio, select, textarea, a typed
  value under a changed `value` attribute) and the template's `checked`
  reaching the property only while the visitor has not touched the control;
  SVG attributes edited in place with `xlink:href` keeping its namespace, no
  pairing of an element with its namesake in another namespace, HTML inside
  `foreignObject` retained; React and Vue hydration markers on one side only;
  a keyed reorder with inserts and removals; an upgraded custom element kept
  whole (shadow root, private field, attributes, no second
  `connectedCallback`), `astro-island` and `data-payload-island`, every
  `contenteditable` spelling but `"false"`, `data-payload-owned`, and a nested
  fragment whose attributes follow the render while its children stay.
- `tests/unit/property/morph-keyed.property.test.ts` — for any two keyed
  lists, the live container ends up equal to the rendered markup, every key
  that survives keeps its element, and a second morph toward the same markup
  moves nothing; unkeyed lists get the markup and the idempotence; the
  focused input of a surviving key keeps focus and caret.
- `tests/e2e/specs/structural-morph.spec.ts` (§7, extended) — in Chromium,
  Firefox and WebKit: a textarea's typed text and caret across an edit and
  across a keyed move; a chosen option and a ticked checkbox across both,
  with the attributes still the visitor's.

One thing the suite found and this change fixes: the applier that commits a
structural update places retained items itself, and that placement is the
same remove-and-insert a keyed move inside the morph is — but it ran outside
the morph's focus capture, so an editor typing into a control inside an item
the update moved lost focus and caret, in every browser. The applier now
captures the focused element before its commit and restores it afterwards,
with the morph's own pair (`captureFocus`/`restoreFocus`, internal). §1's
promise holds for the move whoever makes it.

Two facts the suite made explicit:

- **A text selection across an edited text node collapses.** The node is
  retained, so the selection still points into the live paragraph, but
  writing `nodeValue` is the DOM's "replace data" over the whole node, and
  that algorithm moves every range boundary inside the replaced span to its
  start. A selection over a sibling the edit did not touch is untouched. This
  is what §1 means by retaining the node and not the offsets; a text diff
  that kept offsets would be an engine change, not a contract change.
- **The CMS can open a `<details>` and cannot close one by leaving `open`
  out.** §3 touches a state attribute only when the rendered element carries
  it, and an omission carries nothing. A template that needs both states
  under CMS control has no way to say so today; that is a 2.1 question
  (a declared state marker), recorded in the private register, not changed
  here.

One thing the suite could not carry into the browser: the strict sanitizer
removes `<svg>` and strips `contenteditable` from an author template, so a
structural item that had either on the server is a drawing or a boundary
live and neither once re-rendered — the morph replaces it under §4's
one-sided rule. That is the sanitizer's policy, not the morph's, and belongs
with the sanitizer corpus (2.1 plan, M3); the fixture page carries neither
and says why.
