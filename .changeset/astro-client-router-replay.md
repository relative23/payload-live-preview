---
'payload-live-preview': minor
---

Astro ClientRouter navigation now rebuilds live-preview bindings after an `astro:after-swap` / `astro:page-load` commit and locally reapplies the last accepted unsaved document. The initial page-load signal is ignored because it is not a router commit. A later navigation supersedes work owned by the route being left before the replay begins; a `ready` handshake remains best effort rather than the source of the replay. An `<astro-island ssr>` now receives the current snapshot after Astro removes its hydration marker instead of losing the event before its component listener exists.
