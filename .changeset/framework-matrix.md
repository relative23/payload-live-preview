---
'payload-live-preview': patch
---

Compatibility claims are what the tests run. The README compatibility table is
rendered from the framework versions the fixtures install, and a check fails
when the table, a fixture lockfile or the test matrix disagree. The
Astro-served browser specs run on Astro 4, 5, 6 and 7, which is the evidence
behind the `>=4 <8` peer range (ADR 0009, the Astro peer range is what CI
runs). The built adapters and the server entry also execute inside a
Web-platform-only context — no `process`, `Buffer` or `node:` modules — so
edge compatibility is a passing test rather than a claim.
