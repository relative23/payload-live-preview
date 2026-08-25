---
'payload-live-preview': minor
---

`inspect()` now reports `scheduler.lastFlush.appliedFields`: the field names a
flush applied, in application order.

`applied` was a count, and a count cannot separate "this binding was written"
from "this binding was never scheduled". Both are consistent with a stale
binding sitting next to a non-zero count.

This came out of a real diagnosis. A binding stayed stale while two sibling
fields of the same document updated in the same flush, and the snapshot said
`applied=3` with only two writes observable in the DOM — connected, nothing
pending or deferred, gate inactive, no orphan, and (since the previous release)
no absent field either. Every question the snapshot could answer came back
clean, and the one that mattered — which three fields those were — could not be
asked.

The failure reproduced three times in 320 browser rounds, twice with byte-identical
counts, so the missing name is a specific field rather than noise.
