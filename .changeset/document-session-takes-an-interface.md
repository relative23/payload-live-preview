---
'payload-live-preview': patch
---

`createDocumentSession()` accepts a document typed by an interface, such as the types `payload generate:types` writes. Its `Record<string, unknown>` constraint rejected those with TS2344, though `DocumentSession` itself takes them.
