---
'payload-live-preview': minor
---

New option `skipUnchanged`: a binding whose value is structurally identical to
the one it last applied is not scheduled again.

Every message from the Admin carries the whole document, so on a page with many
bindings almost every value in a keystroke is unchanged, and rendering it again
costs a Lexical pass and a sanitizer pass for nothing. The comparison is
canonical JSON, so a fresh object graph per message still matches; a value that
cannot be given an identity is always applied; a binding on an element the
cache has not written before is always applied; and a write the renderer
refused is not remembered, so the next identical message applies it.

`dependencies` names fields whose change must re-apply other bindings whatever
their own value did — `{ price: ['priceLabel'] }`. It is consulted only with
`skipUnchanged`.

Off by default in 1.x: renderers and `elementUpdate` listeners stop seeing
repeats, which is observable. `inspect().revisions.skippedUnchanged` counts the
skips. Available on the client, the inline runtime and every adapter.

The inline runtime grows by 449 gzip bytes; the bundle budgets moved
accordingly.
