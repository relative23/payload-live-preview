---
'payload-live-preview': minor
---

Fragment endpoints accept an optional `limits.totalTimeoutMs` across body reading, authorization, props and rendering. Props and renderers receive `FragmentRenderInput.signal`; authorization receives a following request signal, and Payload-session checks forward cancellation to their `/me` fetch. The endpoint discards late results, releases its timers and listeners, and stops before the next phase after cancellation. Existing per-phase timeouts keep their defaults. Cancellation remains cooperative and does not replace host execution or concurrent-request limits.
