---
'payload-live-preview': minor
---

Add opt-in document ownership for bindings, so one page can preview several documents without them competing for the same field name.

A binding's identity was its field path alone. On a page that renders a page global, shared metadata, and a list of collection rows, a field called `title` in any of them matched every `title` on the page, and an update meant for one overwrote all of them. Payload already sends the edited document's identity on every message; the runtime simply never correlated it with the DOM.

Declare ownership in markup with `data-payload-owner`, resolved from the nearest marked ancestor (the element itself included) so a shell component can own a region without repeating the marker and a nested document can override what it would inherit. The grammar is `global:<slug>`, `collection:<slug>`, or `collection:<slug>:<id>`.

Enable enforcement with `scopeBindingsByOwner` on `LivePreviewClient` or `generateInlineScript()`. It defaults to `false`, so existing pages keep matching on the field name exactly as before. While enabled, an update reaches only the bindings owned by the document it names, a binding without an owner is never updated, an exact document marker stays unreachable while the message carries no document id, and a message naming neither a global nor a collection changes nothing and warns once. Orphan-field diagnostics became owner-aware, so another document's fields are no longer reported as missing anchors.

Owner changes are observed like every other binding attribute, including on an ancestor that carries no binding of its own.
