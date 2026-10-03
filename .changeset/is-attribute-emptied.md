---
'payload-live-preview': patch
---

The sanitizer empties an `is` attribute instead of removing it. A parsed element's `is` value is immutable and the HTML serializer writes it back after the attribute is removed, so sanitized markup that re-entered the parser still carried `is="…"` and upgraded the element to the page's customized built-in of that name; an empty `is` names nothing, which is what DOMPurify does. Found by the new XSS corpus, which runs 118 vectors and an aimed fuzz under every policy against an allow-list-independent oracle and against DOMPurify (a devDependency).
