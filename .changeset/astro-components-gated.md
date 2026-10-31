---
'payload-live-preview': patch
---

Astro's `PreviewBoundary` and `RichText` write no `data-payload-*` on a response `authorizePreview` did not authorize. They wrote the attributes on every response, so a page behind the middleware published its field names to every visitor although `bind()` and `createPreviewBindings()` withheld them. The element stays. A prerendered page, or a page outside the middleware, has no request to decide for and keeps the attributes.
