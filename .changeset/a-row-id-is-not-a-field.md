---
'payload-live-preview': patch
---

`LP0203` and the unbound-fields overlay no longer list the `id` of a row or a block's `blockType`. Under `subfieldCoverage: 'declared'`, the default since 3.0, a page that binds its rows field by field (`rows.0.label`) was told once per row that `rows.0.id` has a value and no anchor, though nobody types an `id`. The comparison of two updates is unchanged: when a row moves or a relationship switches, the changed `id` still counts, because what the page drew for the old row or document without a binding stayed behind.
