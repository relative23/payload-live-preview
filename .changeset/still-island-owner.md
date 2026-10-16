---
'payload-live-preview': patch
---

Revoke stale island display confirmations when a runtime session ends or a
navigation replaces its owner. Keep only the last display snapshot after
teardown, and preserve a newer message accepted by a display-event listener or
frame-cancellation callback. Scheduler teardown revokes buffered writes before
host cancellation and prevents callbacks from retaining a new frame.
Suspended previews still replay their retained document with fresh confirmations.
