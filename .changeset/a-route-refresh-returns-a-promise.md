---
'payload-live-preview': major
---

`RouteRefresh`, the function given to `registerRouteRefresh()`, returns a promise that settles once the host has committed the fresh render (ADR 0007, row 23; ADR 0028). A host that renders synchronously returns `Promise.resolve()`. A function that returns no promise is no longer taken as already committed: its refresh counts as failed, the revision is written onto the markup that stands, `inspect().revisions.display` names the route as a shortfall, and `LP0810` says so once under `debug`. `<LivePreviewNavigation />` (Next.js), `livePreviewNavigation()` (SvelteKit), the Nuxt module's client plugin and `<LivePreviewRouteRefresh />` return the promise already.
