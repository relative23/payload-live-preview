---
'payload-live-preview': patch
---

A Lexical block with no registered renderer keeps the markup the server drew for it when an edit adds or removes a paragraph. The rich-text write pairs the live elements with the rendered document by position, and gave up on the whole level as soon as the child counts differed, so typing a new paragraph replaced a server-rendered `<figure>` with the empty placeholder (`LP0413`). The pairing now walks in from both ends and stops at two elements that cannot be one node, two tags, or a placeholder against an element of a tag the document renders beside it.
