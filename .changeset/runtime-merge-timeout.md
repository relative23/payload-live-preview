---
'payload-live-preview': minor
---

The DOM runtime takes `mergeTimeoutMs`, a deadline for the merge request `serverURL` makes, on the adapters, `generateInlineScript()` and `LivePreviewClient`. Without one, a merge whose server never answers leaves its update unshown: measured for ten simulated minutes, the page kept what it showed, with `inspect().revisions.display` at `pending`. With `mergeTimeoutMs`, the merge is aborted when the deadline passes, the runtime renders the raw values and reports the shortfall, as it does for a merge the server refused, and an answer that comes later is not read. The option is off by default, so nothing changes for a page that does not set it.
