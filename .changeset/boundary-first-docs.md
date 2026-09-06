---
'payload-live-preview': patch
---

Lead the documentation with the boundary, not the field binding.

On a server-rendered page one attribute per component is enough: the region is
rendered again from the unsaved form state, so conditional sections and derived
values stay correct without naming a single field. The docs led with per-field
annotation instead, which made the package look like more work than it is —
three lines against twelve for the same component, and the twelve-line version
still misses the section that only exists when a field is set.

`bindings.md` now opens with the choice and what each option costs: a boundary
needs a server at request time and the fragment endpoint; field bindings work on
a static build and keep focus and the caret where a re-render would not — which
is why both together, boundary for the component and bindings for the fields
being edited, is the normal case rather than a compromise. `README.md`,
`astro.md` and `hybrid.md` follow the same order.

No behaviour changes; every attribute in the docs already existed.
