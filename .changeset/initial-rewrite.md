---
'@relative23/payload-live-preview': major
---

Complete rewrite toward `1.0.0`. Highlights:

- **Single source of truth**: the inline runtime is now compiled from
  `src/core/runtime.ts` at build time. The `LivePreviewClient` and the
  inline script share every primitive — no more parallel
  implementations to drift out of sync.
- **Schema-driven engine**: parses Payload's `fieldSchemaJSON`, walks
  arrays/blocks/groups/tabs, and applies id-keyed structural diffs with
  optional View-Transitions animation.
- **Complete Lexical renderer**: 16 node types including `upload`,
  `relationship`, `block`, `autolink`, `tab`, indent, RTL.
- **Per-instance architecture**: every primitive is a class; no
  module-level singletons. `destroy()` only affects the calling
  instance.
- **Adapters**: first-class Astro integration (auto-inject script,
  CSP-managing middleware, `renderLivePreviewScript`), Next.js,
  SvelteKit, Nuxt — all share the same core.
- **Security**: 100% security-module coverage. Pattern-based
  localhost matcher, handshake-verified origin lock, CSP nonce + 
  `'strict-dynamic'` recipe, expanded sanitizer with `<img>`,
  `<figure>`, `<video>`, attribute-safe URL escape, prototype-pollution
  guard.
- **DX**: strict TypeScript with `exactOptionalPropertyTypes` /
  `noUncheckedIndexedAccess`, ESLint strict-type-checked, vitest with
  95%+ coverage thresholds, Playwright matrix for chromium/firefox/webkit.

`0.1.0` consumers should follow the migration guide
(`docs/migration.md`). The public surface has changed materially.
