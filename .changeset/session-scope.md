---
'payload-live-preview': patch
---

The runtime releases everything a session acquired through one scope. `destroy()`, `suspend()` and a failed start close it the same way: the session is marked invalid, the work in flight is aborted, and the ready retries, the heartbeat, the message listener, the observers and the scheduler go in reverse order, a failing cleanup logged without stopping the rest. Fifty start/update/destroy cycles leave no timer, listener or observer behind, and every acquisition in the core now names who releases it.
