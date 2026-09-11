---
'payload-live-preview': minor
---

The line about a Lexical block with no renderer now says what happened to it,
not what was meant to happen. `LP0410` used to be reported while the block was
being rendered — before the write knew whether the server's markup for it could
be kept — so on a page where the pairing failed the console said "keeping what
the server rendered" while the image was being deleted. The write speaks now,
after the fact, in two texts: `LP0410` when the server's markup stands, and the
new `LP0413` when it is gone. The second is also the finding `onUnfaithfulPatch`
acts on, so a fragment or route strategy redraws the region where the page has
one.

`inspect()` gains a `fidelity` section: `{ mode, unfaithful, escalated, fields }`.
`unfaithful` counts every binding the runtime knew it could not patch faithfully
(once per element, under every mode, `'ignore'` included), `escalated` how many
of those a strategy was handed. A positive `unfaithful` beside `escalated: 0`
and `route.handler: false` is the reading a page with a degraded preview and no
strategy shows — three facts that were not visible from the outside before.

`lexicalToHtml()` no longer writes to the console for such a block. Its options
take an `onUnrenderedBlock(blockType, placeholderClass)` listener instead, and
`RenderNodeContext` carries it to the node renderers; a custom node renderer
that wraps blocks passes it on by rendering through `ctx.renderChildren`, as
before.
