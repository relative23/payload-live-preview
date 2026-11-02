---
'payload-live-preview': patch
---

A merge that passes `timeoutMs` or `mergeTimeoutMs` now reports the deadline when `fetch` rejects as it is aborted, which most do. The hook's `error` said only that the operation was aborted. The merge itself ended correctly before too.
