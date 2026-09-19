# ADR 0016 — The sanitizer stays in-house, fenced by a corpus, a reference engine and a fuzz

**Status:** Accepted • **Date:** 2026-09-19

## Context

`src/security/sanitizer.ts` is 462 lines of allow-lists and one walk over a
`<template>` fragment. It is the package's own, because "zero dependencies"
is a promise on the box and because the inline runtime carries the sanitizer
into every page (docs/audit.md §7). Two reviews of 2.0.x asked the same
question from opposite sides: is a 462-line sanitizer enough against a class
of attacks that DOMPurify has spent a decade on, and if it is, what proves it?

The choice was between adopting DOMPurify (variant A) and fencing the
in-house sanitizer with evidence that does not depend on its own allow-lists
(variant B). Variant A costs the promise, about 20 KB gzip on every page,
and a second sanitizer on the server (DOMPurify needs a DOM there as well).
Variant B costs test code and a devDependency that never ships.

## Decision

Variant B, with three fences, all in the PR gate:

1. **A corpus** (`tests/unit/security/xss-corpus.ts`, 118 vectors in seven
   classes: event handlers; URL schemes and their encodings; `srcset` and
   media; script, style and active elements; forms and navigation; mutation
   XSS and parser context; DOM clobbering; attributes that steer behaviour).
   `sanitizer-corpus.test.ts` runs every vector under every policy the
   package ships — the `strict` default, the 1.x `compat` policy and the
   author-template options the structural applier uses — and asks three
   questions of each.
2. **An oracle that reads no allow-list** (`sanitizer-oracle.ts`): a
   deny-list of what a browser executes, loads or navigates on. A mistake in
   the sanitizer's lists cannot also be a mistake here. The second question
   is the fixed point: a second pass over the output changes nothing, which
   is where mutation XSS lives.
3. **DOMPurify as the reference engine**, a devDependency: for `strict` and
   templates, every (tag, attribute) pair the sanitizer keeps must be one
   DOMPurify keeps too, over the same parse (a `<template>` fragment,
   sanitised in place). An aimed fuzz (`sanitizer-fuzz.property.test.ts`)
   asks the same three questions of markup assembled from the tags,
   attributes and values an attacker reaches for, 200 runs on a fixed seed
   in the gate and 1 500 runs on four seeds before this record was written.

A finding is a patch with its vector added to `REGRESSIONS`; the corpus never
shrinks.

## What the fences found

- **`is` survived removal.** A parsed element's `is` value is immutable and
  the HTML serializer writes it back after the attribute is removed, so
  sanitised markup that re-entered the parser carried `is="…"` and upgraded
  the element to the page's customized built-in of that name. The attribute
  is emptied now, as DOMPurify does; an empty `is` names nothing (2.0.6,
  audit S9).

## Differences from DOMPurify that are not findings

Each is classified in `sanitizer-oracle.ts` by copying DOMPurify's own
pattern, so the comparison stays exact and a new difference still fails.

- **Hardening we add.** `rel="noopener noreferrer"` and `target="_blank"` on
  an external link (audit S6).
- **The author's custom elements** in a template; DOMPurify refuses custom
  elements by default.
- **`id` and `name` in a template.** DOMPurify's clobbering guard drops a
  value that collides with a `document` or form property. A template keeps
  the author's names because `form` never survives any policy and a named
  property never shadows one the document really has; `compat` keeps `id`
  for the same reason and is exempt from the comparison altogether, its cost
  documented in docs/security.md.
- **Children of removed foreign-named elements.** DOMPurify removes `mglyph`,
  `mtext`, `foreignObject`, `desc` and their kind with their whole subtree
  when they appear in the HTML namespace, as a precaution against the
  integration-point pivots of mutation XSS. Ours removes the containers that
  change namespace (`svg`, `math`, `template`, the raw-text elements)
  outright, unwraps an unknown tag, and pins the fixed point per input.
- **Values that could close a comment, a CDATA section or a raw-text
  element** (DOMPurify's `SAFE_FOR_XML` guard), and **any value that does not
  look like an allowed URI on an attribute that is not a URL sink**
  (DOMPurify's blanket URI rule). A quoted value is a value to the HTML
  parser; the runtime and the server renderer write HTML only; ours checks
  values on `href`, `src`, `srcset`, `cite` and `poster`, the attributes a
  browser navigates or loads from.
- **Markup-like text beside a comment** (DOMPurify's element markup probe),
  which an XML serialisation would write unescaped. Ours removes every
  comment and escapes text on serialisation.

Two things the corpus could not carry into a structural template, recorded
for 2.1 rather than changed here: the strict policy removes `<svg>` with its
content and strips `contenteditable`, so an item that had either on the
server is replaced by the morph once re-rendered (ADR 0008 §8). Admitting SVG
would mean an SVG allow-list of its own; `contenteditable` is one attribute.
Both are policy questions with a byte cost, not gaps in the fence.

## What would change this decision

A finding the fences cannot express — a vector class the oracle has no
deny-list for, or a serialisation context the fixed point does not cover —
or a second engine that ships as one module the inline runtime can carry.
Neither is in sight; the corpus and the fuzz are where the next one would
show up first.
