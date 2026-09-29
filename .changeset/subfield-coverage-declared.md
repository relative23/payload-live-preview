---
'payload-live-preview': minor
---

A page can say which fields it accounts for without binding them: `data-payload-covers="hero.description seo"` (or `createPreviewBindings().covers(...)`) marks those paths and everything below them as handled, so editing them is neither reported as unbound nor sent to a server render. The new `subfieldCoverage: 'declared'` option, on the client, `generateInlineScript()` and every adapter, stops one bound child from covering its whole group: inside a partly bound group, each changed path needs its own binding or a cover, and an uncovered one is named in LP0203 and `inspect().fidelity.fields` and handled by `onUnfaithfulPatch`. The default, `'descendant'`, keeps the previous rule.
