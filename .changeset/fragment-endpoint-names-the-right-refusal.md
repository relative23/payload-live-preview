---
'payload-live-preview': patch
---

The fragment endpoint answers a body it could not parse with `400 shape`
instead of `413 body`.

`readBody()` returned `null` both for a body over the 64 KiB limit and for one
that is not JSON, and the caller turned every `null` into "413 Payload Too
Large" — so eight bytes of `not json`, an empty body and a truncated object all
came back as too large, on all four adapters, while `123` and `{"a":1}`
correctly came back as the wrong shape. The refusal was right and its reason was
wrong, which for a deliberately generic refusal is the one failure that costs a
reader time.

Both statuses and both words were already in the abuse model (ADR 0011 §4): a
refusal still carries a status and one generic word, never a reason. What is
accepted does not change, and the fragment client is unaffected — it maps every
refusal but 401/403 to `LP0801`, whatever the status.
