---
'payload-live-preview': patch
---

`pll-codegen annotate` and `livePreviewAnnotate()` bind a field only on a variable the same file already binds a field of by hand. The scan dropped the variable a field was read from and matched the rest against every collection and global at once, so a card's `{post.title}`, a footer's `{settings.tagline}` or a figure's `{media.caption}` became a binding to the previewed document, and with `--write` every keystroke in the page's title would have been written into the card. On four sites, 16 of the 17 bindings it proposed were wrong, most of them of this kind. A hand binding, `<h1 data-payload-field="title">{page.title}</h1>` or `{...preview.bind('title')}`, now says `page` holds the document, and the other fields printed from `page` are bound when one collection or global has them together with the hand-bound ones; everything else is reported with the reason. To move, bind one field of each document variable by hand and run the annotator again.

An element already bound by a `bind()` or `bindByPath()` spread is no longer given a second, ungated `data-payload-field`, and an element that spreads attributes the scan cannot read is reported instead of bound.
