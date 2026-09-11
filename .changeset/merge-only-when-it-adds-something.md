---
'payload-live-preview': minor
---

`dataMerge` now asks Payload only when the answer can change what the page
shows. Until now every accepted message cost one authenticated POST to the REST
API: eighteen keystrokes, eighteen requests, and nineteen of them on a page with
no binding at all.

Three decisions, in this order (`src/core/merge-need.ts`):

- **Nothing reads a populated value → no request.** A page with no binding, no
  island, no `data-payload-fragment` boundary and no `beforeUpdate`/`afterUpdate`
  listener has nobody to hand the answer to; so does a page whose every binding
  is a plain scalar renderer on a top-level field. A route refresh is not a
  reason to ask: it re-renders the page from the server and never reads these
  values.
- **Nothing populated moved → no request.** The fields the editor changed are
  taken from the message and everything else is carried over from what the last
  merge resolved. Typing into a text field costs nothing.
- **Otherwise one request opens the burst and one closes it.** The rest share
  the request that follows the window, which is the scheduler's `debounceMs`;
  `debounceMs: 0` turns the window off and keeps the two skips. The page never
  waits for a shared request — it renders what it already has, and the answer
  refines it when it lands.

A field that names a document is never rendered from the bare id the panel posts
for it: the value the last merge resolved stays on the page until the new one
arrives.

What changes for a page that reads no populated value at all: it no longer sees
values a collection's `afterRead` hooks would have changed on the way back. Bind
one field through a relationship path (`data-payload-field="venue.title"`) and
the page merges as before.
