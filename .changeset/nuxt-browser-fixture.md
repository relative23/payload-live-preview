---
'payload-live-preview': patch
---

Put the Nuxt adapter under the same browser evidence as the others. Nuxt shipped an adapter but no real-app fixture, so its coverage claim rested on unit and integration tests while Astro, Next and SvelteKit were each driven through a real browser and a real iframe. `examples/nuxt-payload` now runs the Nitro plugin against the same mock admin and the same markup as the other fixtures, and the E2E matrix asserts DOM patching, plain-text XSS handling, preview-only injection and origin enforcement across Chromium, Firefox and WebKit. No runtime code changed — the README simply no longer claims more for Nuxt than was measured, or less.
