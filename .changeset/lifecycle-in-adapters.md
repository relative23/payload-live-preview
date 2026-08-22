---
'payload-live-preview': patch
---

Make the document lifecycle reachable for adapter users. 1.3.0 shipped `bindNavigationLifecycle()` on the programmatic client, but every adapter injects the inline runtime — a separate build that never carried it — so an Astro, Next, SvelteKit or Nuxt consumer using the documented path got none of it and a back/forward-cache restore still left the preview silently dead. The inline runtime now binds `pagehide` and a persisted `pageshow` itself and releases them on `destroy()`. Soft navigation stays unbound, because only the host knows which event its router fires.
