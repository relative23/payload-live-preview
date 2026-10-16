---
'payload-live-preview': patch
---

A fragment render now lands in the boundary on the page, even when a component re-rendered its region while the request was in flight and replaced the boundary element. The render, the fallback patch after a failed render and the `fragmentRender` event go to the one boundary in the document with the same `data-payload-fragment` and `data-payload-fragment-key`. Before, a late response went into the detached element and the page kept the old content. When two boundaries carry that id and key, nothing is written. Under `scopeBindingsByOwner`, only boundaries the current document owns count (ADR 0011, section 1a).
