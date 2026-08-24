---
'payload-live-preview': minor
---

`inspect()` now reports `bindings.absentFields`: bound fields that an update
carried no value for.

A binding whose field is missing from the update is skipped silently — it keeps
whatever text it already has, and nothing says so. That is the exact opposite of
`orphanFields` (a value with no anchor), and until now only one half of the pair
was visible. From the DOM the two indistinguishable cases are "the update never
arrived" and "the update arrived without this field".

The gap surfaced while diagnosing an intermittent test failure where one field
of a document stayed stale while its siblings updated in the same flush. The
snapshot showed a healthy connection, nothing pending or deferred, an inactive
visibility gate and no orphan — every question it could answer came back clean,
because the one that mattered was not being asked.

Cumulative since start, like `orphanFields`.
