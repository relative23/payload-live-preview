---
'payload-live-preview': patch
---

An image from Payload 4's sharp transformer gets its `srcset` back. The transformer writes WebP variants of a JPEG original, and the rule that keeps one format in a `srcset` dropped them all, so the browser only had the original. When no size has the format the element shows, the sizes of its shape are offered. Measured on a real upload under 4.0.0-beta.6.
