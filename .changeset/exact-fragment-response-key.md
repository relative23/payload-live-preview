---
'payload-live-preview': patch
---

Fragment responses must echo the exact boundary key. Any response key that differs from the requested key, including missing versus empty, now produces LP0802 and falls back to patching the current fields instead of morphing server HTML for another boundary. Request deduplication keeps absent and empty internal key values distinct and is scoped to the revision's abort signal, so a new runtime or owner session cannot inherit an in-flight request with a reused revision number.
