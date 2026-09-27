---
'payload-live-preview': patch
---

Fragment requests that are superseded while waiting for a client concurrency slot now leave the queue immediately. A cancelled waiter never starts its fetch, and a permit handed to a request that is cancelled before it resumes is returned to the next request.
