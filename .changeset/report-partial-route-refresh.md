---
'payload-live-preview': minor
---

The built-in route strategy now reports a successful snapshot-free GET or host
refresh as `partial`. `inspect().route.partial` counts those renders, while the
runtime still rebuilds its cache and reapplies every reachable unsaved binding.
Custom strategies that return `refreshed` keep their existing behavior and
declare that their renderer knew the current unsaved revision.
