---
'payload-live-preview': patch
---

The Vite range is recorded and checked instead of assumed.

`quality/compat-matrix.json` now carries the Vite each supported framework major installs — Astro 4 through 7 pull Vite 5 through 8, SvelteKit 2 accepts 5 through 8, Nuxt 3 pulls 7 — with the date it was measured. The compatibility section of the README states the resulting span from that record rather than from prose beside it.

`npm run compat:check` stays offline and now fails three further ways: when the devDependency sits behind the newest major the record names, when a framework major the matrix tests falls outside its declared optional peer range, and when a fixture lockfile installs a Vite outside the recorded span. `npm run compat:refresh` re-reads the record from the registry the way `api:update` re-reads the API reports — with the network, for a maintainer to review as a diff.

This started as an observation: the devDependency stood at Vite 7 while every fixture lockfile installed 8.2.2, and nothing anywhere compared the two. It is now the first thing that gate checks. Renovate also gives a devDependency major its own pull request rather than leaving it in the grouped non-major one, so the proposal arrives before the gate does.
