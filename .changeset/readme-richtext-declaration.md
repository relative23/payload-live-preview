---
'payload-live-preview': patch
---

The README no longer says that `data-payload-field` alone is enough for rich text: an element that can hold uploads or relationships also needs `data-payload-richtext`, because only then does the runtime ask Payload to fill those nodes in. It names `await LivePreviewScript(…)` where it still named the element form. The comments of `BindOptions.richtext` and of `inspect().bindings.orphanFields` in the type declarations say what they cover: `richtext` is also needed for uploads and relationships, and `orphanFields` lists scalars and one group level, not arrays, relationships, rich text or `null`.
