---
'payload-live-preview': minor
---

Adapter-generated preview scripts for Next.js, SvelteKit and Nuxt now listen for the package's navigation-commit event. Each framework guide includes the required host-side bridge: it dispatches the event from the router's commit lifecycle and registers `router.refresh()`, `invalidateAll()` or `refreshNuxtData()` for route escalation. The package does not import those routers or install the bridge automatically.

After a commit, the runtime rebuilds its bindings and locally reapplies the last fully accepted editor document. It still sends one best-effort `ready`, but correctness no longer depends on the admin answering it. SvelteKit data requests are authorized against `event.url`, so a path-bound preview stays authorized when the client router requests its internal `__data.json` URL.
