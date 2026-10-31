---
'payload-live-preview': patch
---

`pll-codegen` follows a field factory in the project: `slugField()`, `linkField()` or `...seoFields()` to the fields they return, and `fields.map(wrapper)` to the fields it wraps. It reported or skipped these, so a schema built with factories came out with holes, and `pll-codegen annotate` then took the missing fields for ones the schema does not have. A function whose body decides, or one from a package, is still reported rather than guessed.
