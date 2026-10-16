---
'payload-live-preview': patch
---

Keep the existing Nuxt module and `pluginSource(options)` calls type-compatible
without `rootDir` when no authorization hook is referenced. A referenced hook
still requires an explicit absolute project root.
