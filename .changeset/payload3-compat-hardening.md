---
'@relative23/payload-live-preview': major
---

Payload 3.x compatibility and public-release hardening:

- **REST data merging** (`serverURL` / `apiRoute` / `mergeDepth`):
  updates are re-fetched through the Payload REST API so relationship
  and upload fields render populated — the same strategy as the
  official client. Payload 3.x sends raw form values only.
- **Fixed head-inline injection**: the runtime now defers startup to
  `DOMContentLoaded` when executed while the document is parsing.
  Previously the Astro integration's injected script crashed on
  `document.body === null` and live preview never started.
- **Heartbeat disabled by default** (`heartbeatMs: 0`): the Payload
  admin sends no keepalive, so the previous 30 s idle timeout produced
  false disconnects while editors paused typing.
- **Preview-gated injection**: server adapters now inject only into
  preview requests (`?preview=true` / `?draft=true`,
  `Sec-Fetch-Dest: iframe`, admin referer) by default; use
  `inject: 'always'` for the old behaviour. Fragment responses without
  `<head>` (server islands) are skipped, Astro ≥ 5 prerendering is
  skipped, immutable response headers are tolerated.
- **CSP defaults fixed**: adapters manage only `frame-ancestors` by
  default (union-merged into any existing policy instead of clobbering
  it). Full `script-src` nonce management is opt-in via
  `manageCsp: 'full'`; `'strict-dynamic'` is opt-in via
  `strictDynamic: true` because it disables `'self'`/host sources and
  broke framework hydration scripts.
- **Nuxt adapter is now real**: `livePreviewNitroPlugin()` hooks
  `render:html`, injects the script, and merges CSP.
- **Lexical auto-detection**: rich-text values bound with a bare
  `data-payload-field` render as rich text — `data-payload-richtext`
  is no longer required.
- **`data-payload-attribute` implemented** with a policed writer
  (event handlers, `style`, `srcdoc`, `formaction`, `id`/`name`
  refused; URL attributes validated). Previously the DSL emitted the
  attribute but the runtime ignored it.
- **New composable server helpers**: `isPreviewRequest()`,
  `mergeCspHeader()`; `documentSavePlugin` is now actually exported.
- **Security hardening**: `srcset` candidate URLs validated,
  `lexicalToHtml` honours `setSanitizerDocument()` during SSR,
  protocol-relative external links get `rel="noopener noreferrer"`,
  `<` escaped in the inline config, production warning when origin
  trust rests on `document.referrer` alone.
- **Protocol honesty**: `previewToken` / `protocolVersion` are
  documented as library extensions (stock Payload sends neither);
  `payload-document-event` and `externallyUpdatedRelationship` typed
  to match the real wire format.
- Astro peer range is now `>=4.0.0 <8.0.0`, E2E-tested on Astro 4 and 7.

Additional hardening from the pre-release competitive audit:

- **Referrer trust is now a fallback, not a union member**: once
  explicit `allowedOrigins` are configured, `document.referrer` can no
  longer widen the allow-list (previously a foreign embedder could be
  trusted alongside the pinned admin origin).
- The inline runtime no longer constructs `new Function` (CSP `eval`)
  — the `import.meta.env` probe is compiled out of the IIFE.
- Honest Next.js/Nuxt guidance: DOM patching targets server-rendered
  markup; client-rendered React/Vue trees should use the official
  `@payloadcms/live-preview-react`/`-vue` hooks. The Next.js middleware
  is documented as CSP-only (it cannot inject into `NextResponse.next()`).
- New `@relative23/payload-live-preview/payload` entry:
  `buildLivePreviewUrl()` generates the `admin.livePreview.url`
  callback from declarative slug → path maps.
- `mergeFetch` option on `LivePreviewClient` (equivalent of the
  official `requestHandler`) for auth headers / custom proxies.
- Weekly protocol-watch CI job asserts the wire-format invariants
  against `@payloadcms/live-preview@latest`.
- Node engines raised to `>=20.19.0` (Node 18/20 are EOL); toolchain
  moved to TypeScript 5.9, Vitest 4, ESLint 10, jsdom 29, esbuild 0.28.
