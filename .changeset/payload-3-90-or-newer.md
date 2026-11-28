---
'payload-live-preview': major
---

The `payload` peer range begins at 3.90.0: `>=3.90.0 <4.0.0 || ^4.0.0-0` (ADR 0007, row 48). Every Payload 3 release before 3.90.0 carries critical advisories that are patched only there (GHSA-66wr-7vmr-p5jq, GHSA-f7hx-52q9-hcrf), so those releases are no longer claimed as supported, as with Astro before 7.2.8. Update Payload inside its major to 3.90.0 or newer; beside an older Payload npm answers `ERESOLVE`. A project that stays on an older Payload 3 stays on the 2.x line of this package.
