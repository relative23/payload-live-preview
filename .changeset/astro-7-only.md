---
'payload-live-preview': major
---

The Astro peer range is `>=7.2.8 <8.0.0` (ADR 0007, row 35; it was `>=4.0.0 <8.0.0`). Astro releases only its current major, and Astro 4 to 6 carry a critical advisory that is patched only in 7.2.8 (GHSA-26w7-cxv4-gfx2), which is also why the range begins at 7.2.8 and not at 7.0.0. The adapter's code is unchanged. A project on Astro 4 to 6 updates Astro or stays on 2.x; the next Astro major enters the range in a minor.
