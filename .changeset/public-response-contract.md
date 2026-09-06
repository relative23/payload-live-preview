---
'payload-live-preview': patch
---

Docs: what a public visitor actually pays, per delivery, held by tests.

`docs/deployment.md` gains a table with three outcomes rather than one claim: a setup that decides per request (SvelteKit handle, Nuxt Nitro plugin, Astro middleware) sends a visitor neither runtime nor bootstrap; a statically built Astro site in `mode: 'loader'` and a Next.js layout with `delivery: 'asset'` send the 679-byte bootstrap, which fetches nothing outside a preview; a Next.js layout with the inlined script and an Astro `mode: 'inline'` build send the whole runtime to everyone.

Every row is pinned by a case in `tests/e2e/specs/public-response.spec.ts`, against the fixture it describes, so the table cannot drift from what the adapters do. Two further cases hold the claims underneath it: the gap between the same page inline and on asset delivery is the runtime, and a request that claims `?preview=true` without passing `authorizePreview` gets the public response byte for byte.

No behaviour changed. The sentence "a visitor pays nothing" was true of some setups and not others, and now says which.
