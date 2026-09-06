---
'payload-live-preview': patch
---

Fix: a Nuxt production build rewrote the embedded runtime.

Nitro's rollup replaces `typeof window` with `"undefined"` everywhere in a bundle — string literals included (`@rollup/plugin-replace` with no notion of code versus data). The runtime travels as exactly such a literal, so a `nuxt build` came out with all six occurrences rewritten: every `typeof window` guard in the runtime inverted, and bytes that no longer matched the integrity hash computed over them. `nuxt dev` externalizes the package, which is why the E2E suite never saw it; mounting the new asset route did, as a failing SRI check.

The generated constants are now emitted as chunks split inside each such token and joined at load (`scripts/serialize-source.ts`). The value is identical and the cost is a few bytes; `.join('')` rather than `+` because esbuild and terser both fold `"a" + "b"` back into one literal and hand the token straight to the next bundler. `process.env`, `import.meta` and `globalThis.process` are treated the same way, and a test asserts no generated file carries one of them whole.
