# payload-live-preview

## 1.0.0

### Major Changes

- 47bb367: Complete rewrite toward `1.0.0`. Highlights:

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

- 912f219: Payload 3.x compatibility and public-release hardening:

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
  - New `payload-live-preview/payload` entry:
    `buildLivePreviewUrl()` generates the `admin.livePreview.url`
    callback from declarative slug → path maps.
  - `mergeFetch` option on `LivePreviewClient` (equivalent of the
    official `requestHandler`) for auth headers / custom proxies.
  - Weekly protocol-watch CI job asserts the wire-format invariants
    against `@payloadcms/live-preview@latest`.
  - Node engines raised to `>=20.19.0` (Node 18/20 are EOL); toolchain
    moved to TypeScript 5.9, Vitest 4, ESLint 10, jsdom 29, esbuild 0.28.

### Minor Changes

- Feature completion for 1.0:

  - **`<RichText />` Astro component** (`/astro/RichText.astro`): SSR-renders
    Lexical fields through the SAME renderer the runtime uses for live
    patches — markup cannot diverge — and emits the binding plus the
    empty-anchor pattern automatically. `registerBlockRenderer` is now
    exported from the main entry for custom block markup.
  - **Draft-first initial loads**: `fetchPreviewDocument()` /
    `fetchPreviewGlobal()` wrap the REST query with `draft=true`, depth,
    locale and auth headers — pass `draft: isPreviewRequest(request)` to
    serve published content to normal traffic from the same loader.
  - **Astro integration `mode: 'middleware'`**: auto-registers the
    preview middleware via `addMiddleware()` + a virtual options module —
    request-time, preview-gated injection for `output: 'server'`
    projects without a hand-written `src/middleware.ts`.
  - **Scroll-preserving reload** in `documentSavePlugin`: the `'reload'`
    strategy (and the revalidate-failure fallback) now restores the
    scroll position after the refresh.
  - **`previewSignals` option** on `isPreviewRequest` and every adapter:
    restrict preview detection to `['query']` for setups that must never
    relax framing headers for unsolicited iframe loads.
  - **Real Next.js and SvelteKit example apps** under `examples/`, both
    E2E-tested (Chromium/Firefox/WebKit) alongside the Astro app —
    51 E2E tests total.
  - **Protocol watch extended to Payload canaries** (4.0 pre-releases)
    as a soft-fail early-warning lane.
  - Benchmarks suite (`npm run test:bench`) with published numbers in
    `docs/benchmarks.md`.
