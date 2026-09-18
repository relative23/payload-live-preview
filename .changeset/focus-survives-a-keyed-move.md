---
'payload-live-preview': patch
---

Focus survives a keyed move in a structural list. The morph restores focus and selection after a move it makes, but the structural applier places items itself, and that placement is a remove-and-insert: an editor typing into a control inside an item that the update moved lost focus and caret. The applier now captures the focused element before its commit and restores it afterwards, the way the morph does (ADR 0008 §1). Found by the morph contract suite in Chromium, Firefox and WebKit.
