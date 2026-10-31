---
'payload-live-preview': minor
---

SvelteKit 3 and Nuxt 4 are supported. CI has run the SvelteKit example migrated to SvelteKit 3.1.1 and the Nuxt example in Nuxt 4.6.3's `app/` layout on every push since 2026-10-30, against the mock admin and from the real admin in Chromium, Firefox and WebKit, on their development servers; the package needed no change for either. The compatibility table lists both, and `quality/compat-matrix.json` has their rows. The production jobs still build the SvelteKit 2 and Nuxt 3 examples. Nuxt 3 keeps working and stays outside official support since its end of life on 31 July 2026.
