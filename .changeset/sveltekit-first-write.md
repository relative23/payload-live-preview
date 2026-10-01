---
'payload-live-preview': minor
---

On a SvelteKit page that runs SvelteKit's client, the first value the admin sends is no longer put back by Svelte's hydration. The SvelteKit handle now declares `hydration: 'sveltekit'` on every script it emits, and the runtime holds its start until SvelteKit's root has mounted; a route served with `csr = false` starts at once, as before. As on Next.js and Nuxt pages, a message posted before the runtime's `ready` is dropped; Payload's admin sends its document in answer to `ready`, so only a tool that posts unprompted at page load needs to wait for it. `hydration` accepts `'sveltekit'` beside `'react'` and `'vue'` for a page built with `generateInlineScript()` (ADR 0015, addendum of 2026-10-01).
