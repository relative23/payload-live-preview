---
'payload-live-preview': major
---

No entry exports a name marked `@internal` at run time any more (ADR 0007, row 15, announced since 2.1). The API reports of 2.5 listed 82 of them: protocol and reconciliation constants, the fragment wire parsers, the codegen's inner steps, the adapters' keys for a request's locals.

- `VERSION`, `generateCspNonce()` and `isLexicalContent()` were among them, each in two entries, and are public now under the same names.
- The other 76 are gone from the entries. An import of one fails, and so does the type check.
- An entry is smaller for it where it loaded code only those exports needed: `/structural` is 5.8 kB with its chunks where it was 26.5 kB.
