---
'payload-live-preview': patch
---

The live region the runtime adds for screen readers, and the unbound-fields overlay, now keep their styling under a Content-Security-Policy whose `style-src` does not allow `'unsafe-inline'`. Both set their declarations through `element.style` instead of a `style` attribute, which such a policy refuses: before, the region showed its messages as ordinary text at the end of the page and the overlay panel lost its layout.
