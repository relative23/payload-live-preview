---
'payload-live-preview': major
---

A merge request has a deadline of 10 000 ms by default: `mergeTimeoutMs` in the adapters, `generateInlineScript()` and the client, `timeoutMs` on `useLivePreviewDocument()` and `createDocumentSession()` (ADR 0007, row 27). When it passes, the request is aborted and a later answer is not read; the runtime renders the raw values and reports the shortfall, a hook reports `unavailable` and keeps the last good document. In 2.x a merge had no deadline unless one was set, so a Payload API that stalled showed up as an update that never arrived. `0` keeps that. A CMS that answers more slowly than ten seconds needs a higher value; the default is about seven times the slowest request of the measurement in ADR 0026. The two development notices that announced the default are gone.
