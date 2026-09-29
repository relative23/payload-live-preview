# ADR 0027 — A fragment request carries the whole document, within measured bounds

**Status:** Proposed • **Date:** 2026-09-29

This record measures what a fragment request carries, keeps the protocol as it
is, and replaces a depth ceiling that refused ordinary content.

## Context

A fragment request posts the boundary's id, the page route and the whole
merged document as `fields` (ADR 0011). The endpoint reads at most
`limits.bodyBytes` (64 KiB by default) and refused `fields` nested deeper than
12 levels with a 400. Every boundary on a page sends its own request, and the
runtime retains one structured clone of the last accepted document for
navigation replay. None of this had been measured against real content.

The measurement took the 37 published documents of a Payload 3 site (six
collections, fetched at depth 2) and synthetic Lexical articles:

| Content                    | Request     | Depth | Retained heap |
| -------------------------- | ----------- | ----- | ------------- |
| categories, team members   | 0.4–1.9 KB  | 3–4   | 0.5–2.6 KB    |
| events, venues, posts      | 4.6–10.1 KB | 7–9   | 6.9–16.5 KB   |
| pages with layout blocks   | 6.5–14.3 KB | 9–13  | 12.4–22.1 KB  |
| an article of ~2 100 words | 26 KB       | 8     | 38 KB         |
| an article of ~4 200 words | 52 KB       | 8     | 74 KB         |
| an article of ~6 300 words | 79 KB       | 8     | 110 KB        |

Two of the four pages were refused: a bulleted list in a column's rich text
inside a layout block is 13 levels deep, so every edit of a fragment boundary
on those pages failed with `LP0801` and was patched instead. A list nested
five levels in the same place is 29 levels. The fixtures render one to three
boundaries per page.

## Decision

### 1. The depth ceiling is 64

`fields` may nest 64 levels. The ceiling exists because the endpoint walks a
body anyone may post before it authorizes it; the walk stops at the first
level past the ceiling, and the byte cap bounds everything else. 64 is twice
the deepest structure measured, and far below what a recursive walk on a
server can take. It stays fixed rather than configurable: no measured content
comes near it.

### 2. The whole document stays on the wire

At one to three boundaries and the measured sizes, a revision uploads at most
about 43 KB, and a boundary's renderer may read any field, including ones the
page declares nowhere. Projection per boundary would need a declared read set
the protocol does not have, and batching would couple boundaries that settle
independently. Protocol version 1 stays unchanged.

### 3. The byte cap stays at 64 KiB and says what it holds

64 KiB carries about 4 500 words of rich text. A larger document is answered
413, reported as `LP0801`, and patched from the same revision; the preview
still shows the edit, without the server's rendering. The default does not
change on 2.x. The endpoint guide states the measured capacity and
`limits.bodyBytes` as the way past it, and the diagnostics table names 413.

## Alternatives

- **Remove the depth check.** The byte cap bounds the size but not the shape:
  64 KiB of nested brackets parses to 32 767 levels, which the check refuses
  in a quarter of a millisecond.
- **A configurable depth.** A knob nobody needs, measured.
- **Raise the byte default.** It widens what an unauthenticated request may
  make the server read; a default change waits for 3.0 and a measurement of
  the deployments that would need it.

## Consequences

- Pages with lists in layout blocks render through their fragment endpoint.
- The retained replay snapshot costs 1.4 to 1.6 times the request bytes of heap,
  one per runtime: 22 KB for the largest measured page.
- Acceptance: parser and endpoint tests with the measured shapes and the
  ceiling on both sides; the capacity table rerun from the unit's artifacts;
  the full chain and the nightly.
