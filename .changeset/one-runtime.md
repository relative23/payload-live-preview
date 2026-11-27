---
'payload-live-preview': major
---

The lean runtime is removed: `LEAN_RUNTIME`, the entry `payload-live-preview/lean`, the `runtime` option of the adapters, the Astro integration and `generateInlineScript()`, the type `RuntimeArtifact` and the diagnostic `LP0104` (ADR 0007, row 37). Delete the import and the option; the build fails on the import until then, and `pll doctor --v3` names the option.

The package has one runtime. To keep it off a visitor's page, deliver it as an asset: `delivery: 'asset'` in the Next.js, SvelteKit and Nuxt adapters, and `mode: 'loader'` in Astro, which is the default. The page then carries a bootstrap of a few hundred bytes, and only a preview fetches the runtime.
