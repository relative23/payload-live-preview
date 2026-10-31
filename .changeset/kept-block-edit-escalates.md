---
'payload-live-preview': patch
---

An edit to a Lexical block with no renderer goes to the fragment or route strategy (`LP0411`). The write keeps the markup the server drew for such a block, and a changed caption stayed the old one on the page while the live region said the change was applied. Text typed around the block still leaves it alone, and a relation the merge populated does not count as an edit.
