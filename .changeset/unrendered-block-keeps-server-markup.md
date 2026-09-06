---
'payload-live-preview': patch
---

A Lexical block with no registered renderer no longer deletes the markup the
server rendered for it. `lexicalToHtml()` renders such a block as an empty
`<div class="lp-block lp-block--<slug>">`, and until now the `richText` write
put that empty element on the page over the `<figure><img></figure>` a project's
own server had already produced for the same block — measured on a Payload 3.88
post: 1 286 characters and one image before the patch, 501 and none after,
triggered by an edit to the _title_.

The write now pairs each placeholder with the element standing in its position
in the live markup and leaves that element where it is, so the rest of the
document is written and the block survives. Pairing is positional — the server
writes no id to match on — and stops where the child counts disagree; then the
placeholder is written after all, exactly as before.

New diagnostic **LP0410**, once per block type: `no renderer for block "x";
keeping what the server rendered for it.` Register one with
`registerBlockRenderer()` (or `registerDefaultBlocks()`) to render it in the
browser too.
