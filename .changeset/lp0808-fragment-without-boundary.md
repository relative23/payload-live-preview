---
'payload-live-preview': patch
---

LP0808 says what is missing on a page with a fragment strategy and no route strategy. When no `data-payload-fragment` boundary covers a field that fell short, the line said that no route or fragment strategy was configured, which sent the reader looking for a configuration that was already there. It now says that not all of the fields lie inside a boundary of this document, and names the two ways out: a boundary around them, or the route strategy.
