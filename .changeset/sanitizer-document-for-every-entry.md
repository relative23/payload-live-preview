---
'payload-live-preview': patch
---

A document supplied with `setSanitizerDocument()` now reaches every entry, so `lexicalToHtml` from `payload-live-preview/lexical` sanitizes on a server.

Every package entry is its own bundle with its own copy of the sanitizer, and the document lived in that copy. A server that called `setSanitizerDocument()` through `payload-live-preview` still got unsanitised HTML, with a warning, from `lexicalToHtml` imported from `payload-live-preview/lexical`, and that entry had no setter of its own. The document is now held once for the whole process, and `payload-live-preview/lexical` exports `setSanitizerDocument` as well.
