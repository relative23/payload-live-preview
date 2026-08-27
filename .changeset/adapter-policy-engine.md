---
'payload-live-preview': patch
---

The Next.js, SvelteKit, Nuxt and Astro adapters now share one preview policy
(`src/adapters/shared/policy.ts`) for intent detection, injection, CSP and
nonce handling instead of carrying four copies of it. Behaviour, options and
public exports are unchanged; the existing adapter tests pass as they were.
`shouldInject` is still consulted only once preview intent is established. Each adapter bundle is
about 0.8 % larger gzipped (+106 to +198 bytes) — one shared decision path
costs slightly more than the straight-line code it replaced; the budgets
were raised by that amount with the measurement recorded.
