---
'payload-live-preview': patch
---

The README no longer says that `data-payload-field` alone is enough for rich text: an element that can hold uploads or relationships also needs `data-payload-richtext`, because only then does the runtime ask Payload to fill those nodes in.
