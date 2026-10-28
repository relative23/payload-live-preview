---
'payload-live-preview': patch
---

A rich-text write keeps the wrapper a template puts around the field (`<div class="prose">`) when the document has a single element. The wrapper was recognized only beside two or more rendered elements, so a one-paragraph value replaced it, and the typography its class carries was gone until the page reloaded. A single element of the wrapper's own tag, or an unrendered block's placeholder, is still paired in place, since it may be the block the server drew.
