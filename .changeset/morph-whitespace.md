---
'payload-live-preview': patch
---

The keyed morph no longer moves a retained element to step around
whitespace-only text nodes the template does not render. Markup that keeps
its source indentation between elements — Astro 4–6, and most SSR output —
made the morph re-insert a focused `<input>`, which blurred it and dropped the
selection.
