---
'payload-live-preview': patch
---

A text binding whose element already reads the value is left as the server drew it. The first message rewrote every bound text, though its words had not changed, and so dropped markup the server put around them, such as a `<span lang>` around a phrase, with `data-payload-text` set; without it the element was refused with `LP0402` and handed to a server as an unfaithful patch on a connection with no edit. The renderer now writes nothing when the element's trimmed text is the trimmed value.
