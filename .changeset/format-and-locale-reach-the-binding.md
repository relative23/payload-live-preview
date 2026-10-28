---
'payload-live-preview': patch
---

A binding follows a `data-payload-format` or `data-payload-locale` the page changes after it has loaded. The format was read once, when the binding was found, and the mutation observer did not watch it, so a template that switched `number:0` to `number:2` on the element it kept went on writing `12`. Under `skipUnchanged`, on by default, a binding was also skipped while its value stayed the same, though the new format, its own new locale or a new message locale would write it differently. The observer now watches `data-payload-format` on a bound element, and the next message writes the value again when the format or the locale changed. The same applies to what a page declares it accounts for: a changed `data-payload-covers`, a `data-payload-depends` on a boundary or route marker, or an element with `data-payload-covers` added or removed now counts on the next edit, where before an edit the page no longer covered could be dropped.
