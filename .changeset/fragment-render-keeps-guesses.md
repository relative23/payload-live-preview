---
'payload-live-preview': patch
---

`autoBind: 'unique'` now keeps the guesses inside a fragment boundary.

A fragment render morphs its boundary toward the server's markup, and that
markup carries no `data-payload-field` stamp, so every guess in the boundary
went with it. The first message renders a boundary as well, which means a guess
inside one never outlived that message; on a page with `fragments` and no route
strategy nothing brought it back, and edits to that field never reached the
preview. After a rendered fragment the runtime now looks for the baseline's own
guesses again — the search a route refresh already ran — and for nothing else: a
value the render brought in is still not bound.

The lean profile renders no fragments and is unchanged; its runtime is
byte-identical.
