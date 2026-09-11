---
'payload-live-preview': patch
---

A Lexical block with no registered renderer survives an edit on a page whose
template wraps the rich text in a `<div class="prose">` — the usual Tailwind
shape, and the shape the block-keeping write could not see. The write paired
the bound element's children with the rendered document's positionally, and a
wrapper is one child where the document has many, so the pairing stopped and
the empty placeholder was written over the server's `<figure>` after all:
measured on a Payload 3.88 post, one image and 1 272 characters before an edit
to the _title_, none and 501 after.

The write now pairs inside the wrapper and writes into it, so the wrapper — and
the classes the typography hangs on — stays as well. A wrapper is the bound
element's only child, a `div`, `section` or `article`, without a binding of its
own, standing where the rendered document has several elements and unlike every
one of them; a `<div>` a registered block renders is content, and a paragraph
typed after it is written beside it, not into it.
