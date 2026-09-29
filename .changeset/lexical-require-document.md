---
'payload-live-preview': minor
---

`lexicalToHtml()` takes `requireDocument: true`, and the `RichText` Astro component a `requireDocument` prop: without a sanitizer document the render then throws `SanitizerEnvironmentError`, as `sanitizeHtml()` does, instead of warning once and returning custom renderers' markup unsanitised. This becomes the default in 3.0. The warning of the lenient path now says so, and it and the sanitizer's error point to the per-call `document` rather than the deprecated `setSanitizerDocument()`. The migration guide gains a "Preparing for 3.0" section.
