---
'payload-live-preview': patch
---

A binding that a framework rebinds after a navigation is written again. Under `skipUnchanged`, the default, the runtime kept the stamp of the value it had last written to the element; when hydration then wrote over that element and gave it another strategy or field, the unsaved value was held back as unchanged and the page kept showing the published text until the field was edited again. The stamp is now dropped with the binding it was written for.
