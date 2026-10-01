---
'payload-live-preview': minor
---

A fragment's `props` receive `locals`: what the framework's own server code put on the fragment request, as a page's `load` sees it on the page request — Astro's `context.locals`, SvelteKit's `event.locals`, Nuxt's `event.context` (Next.js has none, so it is `undefined`). The endpoints pass it through when their wrapper is given it. The SvelteKit guide adds that a component a fragment renders must be imported by the page, so its scoped CSS is on the page before the first unsaved value needs it (ADR 0029).
