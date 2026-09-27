---
'payload-live-preview': patch
---

Fragment planning and fallback now recheck the active revision after consumer callbacks. If a callback synchronously accepts a newer update, the superseded revision cannot start a fragment render or invoke fallback transforms with its older fields.
