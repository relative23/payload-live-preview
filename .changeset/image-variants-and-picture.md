---
'payload-live-preview': patch
---

The `image` and `upload` renderers read Payload 4's `variants` as they read `sizes`, and an `<img>` in a `<picture>` shows the image the editor picked. Payload 4 names an upload's resized copies `variants`, so the live `srcset` had none of them and a size the template chose was lost. The server's `<source>` elements kept winning over the new `src`, so a changed or cleared image stayed the old one; they are removed once the image is no longer the one they were drawn for.
