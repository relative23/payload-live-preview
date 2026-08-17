---
'payload-live-preview': minor
---

Add `createPreviewBindings()`, an authorization-gated emission unit for binding attributes, so a public response can carry no `data-payload-*` at all.

Binding attributes are not neutral markup. `data-payload-field` names a CMS field and `data-payload-owner` names a global, a collection and often a document id, so emitting them unconditionally publishes the shape of the content model — and the identity of documents — to every anonymous visitor and crawler.

The gate itself stays with the application: it is the same verified decision that already controls draft reads and cache policy. What the package now provides is a place to apply that decision once per request, so no individual call site can forget it, and an emission unit that cannot be partially suppressed. While unauthorized, `bind`, `bindByPath` and `owner` all return an empty attribute set.

That indivisibility is the substantive part. A field travels with its type, locale, rich-text marker and owner; gating only the field name leaves the companions behind, which discloses the taxonomy anyway and leaves the runtime looking at a binding whose field is gone. `BindOptions` therefore gained `richtext`, `html` and `locale`, the companions that previously had to be hand-written as literals next to a gated field.

The README documents both the gate and a trap it exposes: consumer CSS keyed on `data-payload-*` couples public layout to preview state, so gating emission silently changes what anonymous visitors see.
