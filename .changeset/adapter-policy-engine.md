---
'payload-live-preview': patch
---

The Next.js, SvelteKit, Nuxt and Astro adapters share one preview policy for
intent detection, injection, CSP and nonce handling instead of carrying four
copies of it. Behavior, options and public exports are unchanged;
`shouldInject` is consulted only once preview intent is established.
