---
'payload-live-preview': patch
---

The root barrel tree-shakes. Importing one symbol from `payload-live-preview`
ships that symbol, not the whole bundle, because the three things that
defeated a consumer's bundler are gone: esbuild's `keepNames`, whose helper
statements cannot be proven pure (name preservation moved to the terser pass
with the same public allow-list, so `fn.name` on exported classes and
functions is unchanged); minification in esbuild, which stripped the
`/* @__PURE__ */` annotations Rollup relies on; and three import-time side
effects in the library itself (the built-in renderer table, Lexical node
registration, an eager `TextEncoder`). A test bundles one-symbol consumers
with Vite against the built package; what one import costs is in
docs/benchmarks.md. Bundles are 6–7 % smaller as a side effect; the inline
runtime is unchanged.
