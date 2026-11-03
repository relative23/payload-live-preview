---
'payload-live-preview': patch
---

`DocumentSession` from `payload-live-preview/core` is an interface now, so TypeScript refuses `new DocumentSession()`. Since 2.3.0 the published declarations offered the class behind `createDocumentSession()` as a value, though no entry exports it: such code compiled under strict ESM and CommonJS settings and then failed at runtime, as an import of an export that does not exist or as `DocumentSession is not a constructor`. The declaration bundler had written the class out as a value although the source exported it with `type`. `createDocumentSession()` and `DocumentSession` used as a type are unchanged; `typeof DocumentSession`, which named the missing constructor, no longer compiles.
