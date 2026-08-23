---
'payload-live-preview': minor
---

Stop charging every visitor for the editor's runtime. A statically built Astro site has no server to decide per request, so `mode: 'inline'` bakes the whole runtime into every page — around 21 KB gzip that only an editor inside the admin iframe will ever execute.

`mode: 'loader'` injects a few hundred bytes instead. They run the same preview-context check the runtime would have run, and only when it says yes do they fetch the runtime as a content-hashed asset with an SRI hash. Measured on this repository's Astro fixture: `index.html` drops from 70 314 to 3 151 bytes, per page.

The asset is configuration-free by design — the bootstrap assigns the config inline, so the file is byte identical for every site on this version. That is what makes it cacheable across pages and deployments, and it is why it cannot carry a deployment secret: there is nowhere for one to go. Its hash and integrity are computed once when this package is built, so a consumer's build does nothing but copy bytes. `astro dev` serves the same path from memory, so a preview behaves identically in development and production.

The detection is shared with the runtime rather than restated. A second copy would drift, and drift here means a preview that silently never starts.

The Astro fixture now runs in loader mode, which puts the whole path through the browser matrix in Chromium, Firefox and WebKit. Astro's inline branch is a single `injectScript` call covered by unit tests, and the inline _runtime_ is still driven end to end by the Next.js, SvelteKit and Nuxt fixtures.
