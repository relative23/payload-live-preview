---
'payload-live-preview': patch
---

Fix: on Vite 8, importing one helper from the root barrel shipped the whole package.

Vite 8 bundles with Rolldown instead of Rollup. The runtime source is emitted as chunks joined at load, and Rolldown would not prove that call pure, so it kept the array and everything reachable from it: `import { escapeHtml } from 'payload-live-preview'` came out at 32 512 bytes gzip instead of 220. Rollup had dropped it either way, which is why the tree-shaking gate — pinned to Vite 7 — never saw it.

The expression is annotated `/* @__PURE__ */` now, which both esbuild and terser preserve: the same import is 2 378 bytes gzip on Vite 8 and unchanged on Vite 7. The focused entries (`payload-live-preview/lexical`, `/structural`, `/core`, `/react`, `/vue`, `/plugins`, `/lean`) were never affected and stay within a few percent of their Rollup figures.

The tree-shaking gate runs on Vite 8 from now on, because that is what Astro 7 and Nuxt install. Every budget in it was re-measured against Rolldown, which is less precise than Rollup at dropping unused declarations out of a bundled module — the numbers moved, the package did not.
