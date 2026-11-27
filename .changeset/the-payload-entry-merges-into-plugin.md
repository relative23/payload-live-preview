---
'payload-live-preview': major
---

`payload-live-preview/payload` merged into `payload-live-preview/plugin` (ADR 0007, row 41). `buildLivePreviewUrl()` and its types are exported from `/plugin` under the same names, and `/payload` is gone from the exports map: the package had `/payload`, `/plugin` and `/plugins` for three different things.

`npx pll migrate ./src --write` rewrites the specifier (`move-payload-entry`) in `import`, `export … from`, `import()` and `require()`.
