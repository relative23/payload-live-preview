---
'payload-live-preview': patch
---

A route refresh registered with `registerRouteRefresh()` that returns no promise now says so once under `debug`, as `LP0810`: the runtime cannot wait for the host's commit and re-applies the unsaved revision at once, on markup the router may still replace. `LivePreviewRouteRefresh` and the SvelteKit and Nuxt recipes already return a promise that settles after the commit. The React guide states the contract, and 3.0 requires the promise (ADR 0028).
