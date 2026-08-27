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

The roadmap (1.3.0) asks for a conservative keyed morph that preserves node
identity where the old and new markup are compatible, and asks this record
to say, before the code exists, what the morph will **never** cross.

## Decision

### 1. Retain, never copy

The morph keeps live nodes and edits them toward the rendered markup. It
never copies listeners, state or properties from one node to another;
whatever a retained node carries — listeners, `value`, `scrollTop`,
playback, an open disclosure — survives because the node does. A node the
morph cannot retain is replaced, and its state is lost the way it always was.

### 2. Compatibility is structural, not semantic

Two elements are compatible when they have the same tag name and namespace
and neither is a boundary (§4). Keys decide the pairing of children:
`data-payload-key` on item roots and `data-payload-nested-key` on nested
slots; unkeyed children pair positionally within their parent. A keyed child
never pairs with an unkeyed one. Text nodes pair positionally and are updated
in place when their data differs; comments are replaced, not compared.

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
  (roadmap 1.3.0, "island interoperability") is the explicit adapter for
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
  not guess which duplicate the author meant.
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
