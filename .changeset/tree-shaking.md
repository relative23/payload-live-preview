---
'payload-live-preview': patch
---

The root barrel now tree-shakes. Importing one symbol from
`payload-live-preview` used to ship the whole bundle (64 KB gzip for
`escapeHtml`); it now ships that symbol (220 B), because three things that
defeated a consumer's bundler are gone: esbuild's `keepNames`, whose helper
statements cannot be proven pure (name preservation moved to the terser pass
with the same public allow-list, so `fn.name` on exported classes and
functions is unchanged); minification in esbuild, which stripped the
`/* @__PURE__ */` annotations Rollup relies on; and three import-time side
effects in the library itself (the built-in renderer table, Lexical node
registration, an eager `TextEncoder`). `npm run test:treeshake` bundles
one-symbol consumers with Vite against the built package and holds each to a
gzip budget. Bundles are 6–7 % smaller as a side effect (root 59.6 → 56.3 KB
gzip); the inline runtime is unchanged.
