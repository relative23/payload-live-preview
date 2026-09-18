---
'payload-live-preview': patch
---

Three diagnostics say what the page does with a field it does not bind. A field that arrives with a value and has no `data-payload-field` on the page is `LP0203` now, once per field: the page does not show it, which a page that renders a subset of the document does on purpose, and the line names where the fact is visible instead of asking for an anchor; `LP0201` and its anchor advice are kept for the field that arrives empty, where the advice is right. `onUnfaithfulPatch: 'escalate'` with neither a route nor a fragment strategy says so once, as `LP0808`, the first time it has something to hand over and nothing to hand it to — before, the default did nothing in silence. `inspect().fidelity.canEscalate` reports whether a strategy exists.
