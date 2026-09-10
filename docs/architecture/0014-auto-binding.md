# ADR 0014 — Auto-binding: what the runtime may guess, and what it must never

**Status:** Accepted • **Date:** 2026-09-10 (written before any Z9 commit; default decided the same day)

## Context

Every measured area of the audit is closed or on its way except one:
**Integrationsaufwand**. Payload's hook costs a call and no markup. Ours costs
`data-payload-field` on every element that should update. The codemod
(`pll-codegen annotate`) and the dev overlay reduce the work; they do not
remove it, and for a project that will not carry the attributes at all the
honest answer today is "use the hook", which is Payload's answer.

Z9 asks whether the runtime can find the bindings itself.

The idea is small. Since Z2 and Z3 the runtime knows that the first message of
a connection describes a state the server has already rendered. In that one
moment the document and the DOM are two views of the same thing, so a field's
value can be looked for in the page — and where it is found exactly once, the
element that holds it is the element that field renders.

### Why the alternatives do not reach the goal

- **Build-time annotation** (what `R8` gives Astro) rewrites the template, so
  no attribute is written by hand. It needs a template whose own scope reaches
  the request context: Astro's frontmatter and `Astro.locals` do, a Svelte or
  Vue component does not, and Next brings no Vite. It closes one framework,
  not the axis.
- **A wrapper component** (`<Bound field="title">`) is the attribute with a
  different syntax. Same work, same review, same forgetting.
- **A server-emitted map** (field → element path, shipped with the response)
  is build-time annotation moved to runtime; it needs the same template access
  and additionally a channel to carry it.

Value matching is the only mechanism that needs nothing from the template.

## Decision

### 1. Only on the baseline, and only where the answer is unambiguous

A candidate is created for a scalar field whose value is found in the page as
**the entire text content of exactly one text node**, or the entire value of
exactly one attribute the writer is allowed to set. More than one match, zero
matches, a partial match, or a match split across nodes: no binding.

The search happens once, on the connection's first message, and never again.
A later message cannot create a binding — by then the DOM is what the runtime
made it, and matching against one's own output is circular.

### 2. `data-payload-field` remains the only _consent_

This is the point of the record, and it is a genuine change to the package's
posture, so it is stated rather than buried.

Until now an element is written **because its author said so**. The sanitizer,
the attribute allow-list and the URL checks decide _how_ a write happens;
`data-payload-field` decides _whether_. Auto-binding replaces "the author said
yes" with "the runtime found a match". That is strictly weaker.

It is therefore constrained the way a guess should be:

- **Never** inside `<script>`, `<style>`, `<template>`, `<title>`, a form
  control's value, a `contenteditable` subtree, a shadow root, or an element
  or ancestor carrying the opt-out attribute. Z9's first commit named it
  `data-payload-no-bind` (`src/core/auto-bind.ts`); until then this record
  left the name open on purpose, because the docs gate rightly refuses an
  attribute name the code does not define. `data-payload-owned` and an island
  are boundaries here as they are for the morph, and the search stays in the
  body — a `<head>` binding needs the attribute and the route strategy.
- **Never** an attribute other than the ones `isWritableAttribute` already
  admits (Z22 extracted it; there is no second rule).
- **Never** a value shorter than a floor, and never one that is only digits,
  a boolean, an enum-looking token or a locale code — those match by accident.
  The floor is a measurement, not a guess: 13, the shortest length at which
  no page in the trap corpus binds anything (`AUTO_BIND_MIN_LENGTH`, with the
  sweep in its comment).
- **Never** silently. Every guess is written onto its element as the
  attributes a template would have carried plus `data-payload-guessed`
  holding the value that matched, so a cache rebuild finds it again like any
  binding and the page itself answers "why did this element change?".
  `inspect().bindings.guessed` lists them with that value, and the dev overlay
  shows them apart from the declared ones.

An explicit `data-payload-field` always wins, both as an anchor and as a
veto: a page that carries one attribute is not thereby opted into guessing
for the rest — `autoBind` is what opts in.

### 3. It fails closed

A field the search cannot place stays unbound, and unbound since Z3 means
`onUnfaithfulPatch: 'escalate'`. A page with `autoBind` on and no strategy
therefore behaves exactly as it does today for anything the guess misses:
nothing is written, and the diagnostic says which field.

This is why auto-binding does not need to be complete to be useful, and why a
low hit rate is a disappointment rather than a hazard.

### 4. A formatted field is never guessed

The server writes `Apr 12, 2025`, the document carries
`2025-04-12T08:30:00.000Z`, the two do not match, no binding is made. That is
the correct outcome and it is also the reason Z20 exists: without a
diagnostic, "the runtime silently did not bind your date" is indistinguishable
from "there is nothing there". Z9 depends on Z20 having landed, or on landing
its diagnostic itself.

## What counts as failure

Named here so the answer is not negotiated after the code exists.

**F1 — a unique but wrong match.** The dangerous class is not ambiguity, which
fails closed; it is a value that occurs exactly once and in the wrong place: a
`year` field of `2024` matching a copyright line, a `city` matching a footer
address. If the runtime binds it, typing in that field rewrites unrelated
markup.
_Measured by:_ a corpus of trap pages where each field's value also appears
outside its element. The runtime must bind **none** of them. And the fidelity
oracle must stay green — a wrong write is a divergence from the server's
render, which is exactly what the oracle sees.

**F2 — a hit rate too low to change the axis.** If, with every attribute
removed, the demo's pages recover a minority of their bindings, then "no
markup in the standard case" is false and the honest score for
Integrationsaufwand stays where it is.
_Measured by:_ `payload-demo` with all `data-payload-field` removed, counting
declared-before against guessed-after, per page. A threshold is not set here
on purpose — the number is the finding.

**F3 — the baseline gets expensive.** The search is fields × text nodes, once.
On a large page that may be milliseconds that a keystroke does not have.
_Measured by:_ a scenario in the interaction budget, and the existing p95
floor/ceiling must hold. It is a one-off cost on connect, not per message, so
it may exceed the per-keystroke budget — but it must be stated, not absorbed.

**F4 — it cannot be turned off in the mental model.** If a maintainer cannot
answer "why did this element change?" by looking at the page, the diagnostic
work of the last two weeks is undone.
_Measured by:_ `inspect()` and the overlay distinguish guessed from declared,
and a guessed binding names the value it matched on.

## The default, decided

`autoBind: 'off' | 'unique'`, **default `'off'`.** Decided by the maintainer
on 2026-09-10, with the reasoning above in front of them: build it complete,
ship it off, and let F1 and F2 say whether it ever becomes the default. A
project that upgrades gets nothing it did not ask for; a project that turns
it on gets a guess that fails closed and says what it guessed.

If F1 is clean and F2 is high, flipping the default is a one-line change with
this record as its justification. If either comes out badly, the measurement
is recorded and Integrationsaufwand keeps its current score — a guess that
writes to the wrong element is worse than an attribute someone has to type.

## Consequences

- A project may run with no `data-payload-field` at all and still get a live
  preview, on every framework, where the values are findable.
- The package gains a mechanism whose correctness is statistical rather than
  declared. Everything else in it is declared. That asymmetry is the price,
  and the four failure modes above are how it is kept visible.
- If F1 or F2 comes out badly, the right outcome is to record the measurement
  and leave Integrationsaufwand at its current score. A guess that writes to
  the wrong element is worse than an attribute someone has to type.
- **A route refresh lost every guess once, and this is how it was closed.**
  The refresh morphs the page toward the server's own markup, which carries
  no stamp; measured on 2026-09-10 (Z26), two guesses were gone after the
  first refresh and every later edit to a guessed field fetched the route
  again instead of patching. Since then the runtime looks for the baseline's
  own guesses again on the fresh markup, once per refresh — by the value each
  was found by and by the field's value in the revision, because the server
  may have rendered either — and for nothing else: §1 holds for every field
  the first message did not bind, so a refresh is not a second baseline. The
  other way, a stamp that survives the morph, was measured and is wrong: the
  morph pairs unkeyed siblings of one kind by position, and a paragraph the
  server inserted before a guessed one took the guess with it. What is not
  closed: a fragment render inside a boundary strips a guess in that boundary
  the same way, and only the next route refresh brings it back — on a page
  with `fragments` and no route strategy the guess is lost for good.
