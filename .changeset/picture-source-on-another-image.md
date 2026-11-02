---
'payload-live-preview': patch
---

Choosing another image for an `<img>` in a `<picture>` now always removes the `<source>` elements. When the new image had a size of the name the element had kept, the sources stayed, and a browser that picked one went on showing the old image.
