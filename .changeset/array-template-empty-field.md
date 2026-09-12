---
'payload-live-preview': patch
---

An array row that does not carry one of the template's fields renders that
placeholder as nothing, instead of printing `{{field}}` into the page. Adding a
row and not filling every field is the normal first second of editing one, and
until now the editor watched template syntax appear in the preview. A
placeholder that _no_ row can fill is still written out: that one is a typo in
the template, and hiding it would hide the mistake.
