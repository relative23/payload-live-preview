---
'payload-live-preview': patch
---

Deliver island updates when a revision renders only fragments. Pending server requests no longer suppress the island event, and later fallback patches do not deliver the same snapshot twice. Reentrant teardown cannot complete or notify an obsolete revision. This does not change Astro/React hydration readiness.
