---
'payload-live-preview': minor
---

`BindOptions` takes `format`, `text`, `strategy`, `dependsOn` and `anchor`, and `previewBindingsFromLocals()` is public. A gated binding could not carry these, so a page wrote them beside the binding, where they stayed behind when the gate closed. `anchor: true` writes `data-payload-boundary`, the gated form of an anchor for a field that may be empty.
