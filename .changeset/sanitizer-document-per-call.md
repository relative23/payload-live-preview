---
'payload-live-preview': minor
---

The sanitizer's document is named per call. `sanitizeHtml(html, { document })`, `lexicalToHtml(content, { document })` and the `RichText` Astro component's `document` prop take an SSR document such as linkedom's, so two requests rendering at once each parse in their own DOM and nothing is shared through the process. `setSanitizerDocument()` stays as the fallback for a call that names none and is deprecated for 3.0.
