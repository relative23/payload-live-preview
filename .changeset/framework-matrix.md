---
'payload-live-preview': patch
---

Compatibility claims are now what CI runs. `quality/compat-matrix.json` names
the framework versions the fixtures install, `scripts/compat-table.ts`
renders the README compatibility table from it and `npm run compat:check`
fails when the table, a fixture lockfile or the workflow matrix disagree. A
new `astro-matrix` CI job runs the Astro-served browser specs on Astro 4, 5
and 6 as well as 7 (ADR 0009 keeps the `>=4 <8` peer range on that
evidence), and `npm run test:edge` executes the built adapters and the
server entry inside a Web-platform-only `node:vm` context — no `process`,
`Buffer` or `node:` modules — so edge compatibility is a passing test.
