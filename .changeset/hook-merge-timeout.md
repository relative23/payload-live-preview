---
'payload-live-preview': minor
---

`useLivePreviewDocument()` from `payload-live-preview/react` and `payload-live-preview/vue` takes `timeoutMs`, a deadline for the merge request. Without one, a merge whose server never answers stays in flight: measured for ten simulated minutes, the hook kept `isLoading: true` and `status: 'idle'` with no `error`. With `timeoutMs`, the merge is aborted when the deadline passes, the update reports `status: 'unavailable'` with an `error` that names the deadline, `data` stays the last good document, and an answer that comes later is not read. A newer update gets its own deadline. The option is off by default, so nothing changes for a hook that does not set it.
