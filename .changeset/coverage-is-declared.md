---
'payload-live-preview': major
---

`subfieldCoverage` defaults to `'declared'` (ADR 0007, row 17; ADR 0022). Inside a group the page binds only in part, each changed path needs a binding of its own, a binding above it or a `data-payload-covers` declaration. An uncovered one is an unbound change: `LP0203` and `inspect().fidelity.fields` name it, and `onUnfaithfulPatch` decides whether a server draws it. In 2.x one bound path covered the whole group, so an edit beside it changed nothing on the page and nothing said so.

- Declare what a page leaves out on purpose: `data-payload-covers="hero.description"`. The `id` of an array row or of a related document counts as a path as well, so a page that binds `author.name` hears about `author.id` when the relationship switches; `data-payload-covers="author"` on the element that shows the author accounts for it.
- `subfieldCoverage: 'descendant'` keeps the 2.x rule.
- A path a route marker names (`data-payload-depends="layout.1.note"`) now changes only when the value at that path does, not with every edit of its field.
- `LP0204`, the development notice that announced this, is gone.
