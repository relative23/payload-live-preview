---
'payload-live-preview': patch
---

A rich-text value whose nodes are all empty paragraphs, the shape an emptied Lexical editor holds, counts as empty, as `null` does. Such a value kept a `data-payload-boundary` anchor visible, and the built-in `richText` renderer wrote `<p></p>` into the element, so a `:empty` rule on it stopped matching. The anchor now gets `hidden` back and the element is emptied; a project `renderRichText` still receives the value and decides what it shows.
