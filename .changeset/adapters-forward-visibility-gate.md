---
'payload-live-preview': minor
---

The adapters accept `disableVisibilityGate` and `visibilityGateThreshold` and pass them to the inline script. Until now both options existed only on `LivePreviewClient` and `generateInlineScript()`, so a page served through an adapter with more than 50 bindings held its off-screen writes until they were scrolled into view, and nothing in the adapter options could change that. `pll doctor` now judges `LP0705` against the threshold the served script sets, and reports nothing when the script turns the gate off. `generateInlineScript()` now refuses a numeric option that JSON cannot write, such as `visibilityGateThreshold: Infinity` or `NaN`, instead of writing it as `null`, which the runtime read as unset; for the threshold the error points to `disableVisibilityGate: true`.
