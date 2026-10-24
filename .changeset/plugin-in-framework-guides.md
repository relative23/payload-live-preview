---
'payload-live-preview': patch
---

The framework guides show the config plugin as the way to point the Payload admin at the site. The Astro guide's step 4 named only the lower-level `buildLivePreviewUrl()` helper, and the Next.js, SvelteKit, Nuxt, plain HTML, React and Vue guides had no Payload step at all. Each now has the plugin and names the three cases that still need the helper: a document without a route, another plugin that sets the Live Preview URL, a signed token in the URL. Documentation only.
