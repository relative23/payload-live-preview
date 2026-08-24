# payload-live-preview

## 1.7.0

### Minor Changes

- 491d2f9: `inspect()` now reports `bindings.absentFields`: bound fields that an update
  carried no value for.

  A binding whose field is missing from the update is skipped silently — it keeps
  whatever text it already has, and nothing says so. That is the exact opposite of
  `orphanFields` (a value with no anchor), and until now only one half of the pair
  was visible. From the DOM the two indistinguishable cases are "the update never
  arrived" and "the update arrived without this field".

  The gap surfaced while diagnosing an intermittent test failure where one field
  of a document stayed stale while its siblings updated in the same flush. The
  snapshot showed a healthy connection, nothing pending or deferred, an inactive
  visibility gate and no orphan — every question it could answer came back clean,
  because the one that mattered was not being asked.

  Cumulative since start, like `orphanFields`.

## 1.6.0

### Minor Changes

- d8bc7b8: Stop charging every visitor for the editor's runtime. A statically built Astro site has no server to decide per request, so `mode: 'inline'` bakes the whole runtime into every page — around 21 KB gzip that only an editor inside the admin iframe will ever execute.

  `mode: 'loader'` injects a few hundred bytes instead. They run the same preview-context check the runtime would have run, and only when it says yes do they fetch the runtime as a content-hashed asset with an SRI hash. Measured on this repository's Astro fixture: `index.html` drops from 70 314 to 3 151 bytes, per page.

  The asset is configuration-free by design — the bootstrap assigns the config inline, so the file is byte identical for every site on this version. That is what makes it cacheable across pages and deployments, and it is why it cannot carry a deployment secret: there is nowhere for one to go. Its hash and integrity are computed once when this package is built, so a consumer's build does nothing but copy bytes. `astro dev` serves the same path from memory, so a preview behaves identically in development and production.

  The detection is shared with the runtime rather than restated. A second copy would drift, and drift here means a preview that silently never starts.

  The Astro fixture now runs in loader mode, which puts the whole path through the browser matrix in Chromium, Firefox and WebKit. Astro's inline branch is a single `injectScript` call covered by unit tests, and the inline _runtime_ is still driven end to end by the Next.js, SvelteKit and Nuxt fixtures.

## 1.5.0

### Minor Changes

- 8cbe510: Give every diagnostic a stable code. Prose gets reworded; a code does not, so a log filter, an alert rule, or a bug report that names `LP0301` keeps meaning the same thing after the sentence around it is rewritten — and a code is greppable in a way a sentence fragment is not.

  Fourteen codes cover what the runtime reports today, grouped by the question they answer: configuration and origin trust (`LP01xx`), bindings and markup (`LP02xx`), scheduling (`LP03xx`), rendering (`LP04xx`), messages (`LP05xx`), and consumer callbacks (`LP06xx`). Every warning now prints its code, and the `error` event carries `code` alongside the existing `context` — branch on `code`, read `context` for the human-readable origin. `DIAGNOSTIC_CODES` is exported so consumers can name a code instead of copying a literal.

  A test holds the registry against the source tree in both directions: no code is emitted that the registry does not define, and no registry entry exists that nothing reports. `LP0604` is reserved rather than assigned, because a throwing token validator is deliberately treated as a rejection and reported as `LP0502` — there is nothing distinct to report yet, and the number stays reserved rather than being handed to something else.

- a28e955: Let a running preview explain itself. `inspect()` returns a point-in-time snapshot of what the runtime actually sees — bound and orphaned fields, the document owners on the page, the origin it locked onto, revisions accepted and superseded, the negotiated protocol, and the scheduler's pending and deferred work with the visibility gate's threshold and whether it is currently deferring. It performs no I/O and transmits nothing.

  It is reachable where the failures happen: `__livePreview.inspect()` on the global handle every adapter injects, and `client.inspect()` for consumers driving the runtime themselves. Shipping diagnostics to the programmatic client alone would repeat the mistake that made `bindNavigationLifecycle()` unreachable for adapter users in 1.3.0.

  The snapshot is not gated to development builds. It discloses nothing that is not already on the page — the trusted origins are inside the injected script, the field names are `data-payload-field` attributes in the DOM — and a preview that only misbehaves on the deployed site is exactly the case where the information is worth having.

  Fixed along the way: the protocol negotiation compared only the negotiated version, so a remote party announcing version 1 left `protocol.theirs` as `undefined`, indistinguishable from one that never announced at all.

- 73be6a3: Add `pll doctor`, an audit of what a deployment actually serves. `inspect()` answers "what is this runtime doing right now" from inside the page; the doctor answers the question one step earlier, from outside it.

  `npx pll doctor <url> --admin <origin>` fetches the URL twice — once as an ordinary visitor, once with the headers the admin's iframe sends — and reports the difference. That comparison is the whole design. A configuration file can say `allowedOrigins: [...]` while a proxy strips the header, an adapter runs in an inject mode nobody remembers choosing, or a build emits binding attributes on public pages; the gap between what a project believes it is configured to do and what it puts on the wire is where this package's most expensive findings have lived.

  Verified against a real same-origin consumer before release, which immediately paid for itself: the first run produced three findings and all three were wrong for that topology. `'self'` in `frame-ancestors` does name the admin when admin and site share an origin, `X-Frame-Options: SAMEORIGIN` does permit that framing, and a missing inline runtime is expected when the consumer starts `LivePreviewClient` themselves. All three are corrected and pinned by regression tests; a missing runtime is now a warning that names both readings rather than an error that assumes one.

  Seven checks, each stamped with a code: no runtime in the preview response, a missing `frame-ancestors` or one that excludes the admin origin, an `X-Frame-Options` that no CSP can undo, binding attributes served to anonymous visitors, more bindings than the visibility gate writes eagerly, bindings outside every owner marker, and a runtime with nothing to write into. Exit code 2 on any error-level finding, so it drops into CI against a deploy preview; `--json` emits the report as data.

  `analyzeProbe()` is exported from `payload-live-preview/doctor` for callers who fetch the responses themselves — the judging is pure, and only the fetching lives in the CLI. The audit makes exactly the two requests it is told to make, sends no credentials, and reports no telemetry.

## 1.4.1

### Patch Changes

- fd69bde: Make the document lifecycle reachable for adapter users. 1.3.0 shipped `bindNavigationLifecycle()` on the programmatic client, but every adapter injects the inline runtime — a separate build that never carried it — so an Astro, Next, SvelteKit or Nuxt consumer using the documented path got none of it and a back/forward-cache restore still left the preview silently dead. The inline runtime now binds `pagehide` and a persisted `pageshow` itself and releases them on `destroy()`. Soft navigation stays unbound, because only the host knows which event its router fires.
- 652183e: Put the Nuxt adapter under the same browser evidence as the others. Nuxt shipped an adapter but no real-app fixture, so its coverage claim rested on unit and integration tests while Astro, Next and SvelteKit were each driven through a real browser and a real iframe. `examples/nuxt-payload` now runs the Nitro plugin against the same mock admin and the same markup as the other fixtures, and the E2E matrix asserts DOM patching, plain-text XSS handling, preview-only injection and origin enforcement across Chromium, Firefox and WebKit. No runtime code changed — the README simply no longer claims more for Nuxt than was measured, or less.

## 1.4.0

### Minor Changes

- e6b332e: Publish which schema fields a binding can actually address. `pll-codegen --inventory <path>` writes every addressable field as JSON — spelled the way the runtime resolves it — and `checkPreviewBindings()` cross-checks bindings a consumer has already extracted, reporting unknown slugs and fields that no longer exist. The path convention is the part worth publishing rather than documenting: structural containers (`tabs`, `row`, `collapsible`) contribute no segment, arrays address items through `.*`, and blocks through `.*.<slug>`. Markup extraction stays with the consumer, because resolving a binding expression in Astro, JSX or Svelte is framework work this package cannot do generically.

## 1.3.0

### Minor Changes

- b15eb33: Own the document lifecycle instead of leaving it to every integration. `LivePreviewClient` gains `suspend()` and `resume()`, and `bindNavigationLifecycle()` wires them to `pagehide` and a persisted `pageshow`. A back/forward-cache restore does not re-run module scripts, so a client that stays attached across `pagehide` comes back bound to a document the browser froze and thawed, and silently stops updating. Unlike `destroy()`, a suspension keeps plugins, renderers and transforms, so the same client comes back. Soft-navigation cache rebuilds are opt-in per event name, because the package cannot know which framework is present.

## 1.2.2

### Patch Changes

- a1afc20: Report the first flush the visibility gate holds back. The scheduler stops writing offscreen elements once the binding cache exceeds `visibilityGateThreshold` (default 50) and buffers them until they scroll into view; nothing said so, and the symptom — a page that stops updating below the fold the moment it crosses the threshold — is indistinguishable from a broken runtime. Behaviour is unchanged: the knob already existed, it was simply invisible, and the one code path that saw the deferral returned early on the flushes worth reporting.
- dc2b6da: Stop the release-critical mutation gate from failing on measurement noise. The baseline was compared exactly, so a single mutant that survives on one machine and dies on another moved the second decimal and turned scheduling luck into a red release. The policy can now declare how many flipped mutants count as noise; drift inside that band is reported for diagnosis and no longer fails the run, while a drop below the band is still a regression and a gain above it still demands a ratchet. Policies that declare no band keep comparing exactly.

## 1.2.1

### Patch Changes

- 41f2b1a: Wait for npm to actually serve a freshly published version instead of failing the release on the first read.

  npm acknowledges a publish before the new version is readable, and every read the release performs afterwards happened exactly once. All three 1.0.x releases published correctly and then went red: 1.0.5 and 1.1.0 could not observe the version at all, and 1.2.0 saw the metadata but got `ETARGET` when downloading the tarball. Each left the git tag and the GitHub release unmade until the job was re-run by hand.

  Both post-publish reads now retry within a bounded budget — three minutes at five-second intervals — and the first attempt is never delayed, so a registry that is already consistent costs nothing. Only the shapes npm uses while propagating (`ETARGET`, `E404`, `notarget`) are retried; every other failure still fails immediately, so waiting can never mask a real fault.

## 1.2.0

### Minor Changes

- 7dec677: Add `createPreviewBindings()`, an authorization-gated emission unit for binding attributes, so a public response can carry no `data-payload-*` at all.

  Binding attributes are not neutral markup. `data-payload-field` names a CMS field and `data-payload-owner` names a global, a collection and often a document id, so emitting them unconditionally publishes the shape of the content model — and the identity of documents — to every anonymous visitor and crawler.

  The gate itself stays with the application: it is the same verified decision that already controls draft reads and cache policy. What the package now provides is a place to apply that decision once per request, so no individual call site can forget it, and an emission unit that cannot be partially suppressed. While unauthorized, `bind`, `bindByPath` and `owner` all return an empty attribute set.

  That indivisibility is the substantive part. A field travels with its type, locale, rich-text marker and owner; gating only the field name leaves the companions behind, which discloses the taxonomy anyway and leaves the runtime looking at a binding whose field is gone. `BindOptions` therefore gained `richtext`, `html` and `locale`, the companions that previously had to be hand-written as literals next to a gated field.

  The README documents both the gate and a trap it exposes: consumer CSS keyed on `data-payload-*` couples public layout to preview state, so gating emission silently changes what anonymous visitors see.

- a8a972f: `buildLivePreviewUrl` can now decline a document instead of always producing a URL.

  The callback returned `string`, so "this document has no preview target" was unexpressible. A draft without a slug, a collection that is never rendered, a document with no id — each of them fell through to the fallback path and pointed the preview iframe at an unrelated public page. Payload's own `url` callback accepts `null` for precisely this case and then shows no iframe. Consumers were writing guards around the helper to recover that.

  A resolver may now return `null`, and `fallback` accepts `null` to decline every unmapped document. Both forms stay distinguishable at the type level: with string-only resolvers and a string fallback the callback keeps its 1.0 signature and always produces a URL, while using `null` anywhere widens the return type to `string | null`. Existing configurations are unaffected in behaviour and in type.

  An empty string keeps its 1.x meaning and falls back, and a slug mapped explicitly to `null` is now treated as a resolver in its own right rather than as an absent entry.

## 1.1.0

### Minor Changes

- bc21563: Add opt-in document ownership for bindings, so one page can preview several documents without them competing for the same field name.

  A binding's identity was its field path alone. On a page that renders a page global, shared metadata, and a list of collection rows, a field called `title` in any of them matched every `title` on the page, and an update meant for one overwrote all of them. Payload already sends the edited document's identity on every message; the runtime simply never correlated it with the DOM.

  Declare ownership in markup with `data-payload-owner`, resolved from the nearest marked ancestor (the element itself included) so a shell component can own a region without repeating the marker and a nested document can override what it would inherit. The grammar is `global:<slug>`, `collection:<slug>`, or `collection:<slug>:<id>`.

  Enable enforcement with `scopeBindingsByOwner` on `LivePreviewClient` or `generateInlineScript()`. It defaults to `false`, so existing pages keep matching on the field name exactly as before. While enabled, an update reaches only the bindings owned by the document it names, a binding without an owner is never updated, an exact document marker stays unreachable while the message carries no document id, and a message naming neither a global nor a collection changes nothing and warns once. Orphan-field diagnostics became owner-aware, so another document's fields are no longer reported as missing anchors.

  Owner changes are observed like every other binding attribute, including on an ancestor that carries no binding of its own.

## 1.0.5

### Patch Changes

- 6cdea3b: Preserve `ready: true` as a boolean in the minified inline runtime handshake so strict Payload protocol consumers can establish live preview reliably.

## 1.0.4

### Patch Changes

- adeda09: Make live-preview updates revision-safe, discard stale asynchronous work across lifecycle generations, and report only DOM changes that were actually applied.

  Apply plugin transforms consistently, restore layered renderers on teardown, and release every listener, transform, renderer, and cleanup registered through a plugin context. Harden Payload message, merge-path, CSP, and preview-boundary validation while clarifying that preview intent is not authorization.

  Isolate shared accessibility resources across clients while preserving adopted consumer DOM, make binding-cache updates atomic, observe all binding metadata, and keep consumer diagnostics from interrupting event dispatch, updates, fallbacks, or teardown. Apply structural-array DOM changes synchronously so completion events describe real writes and destroyed clients cannot receive deferred transition callbacks. Preserve literal template values, including JavaScript replacement metasequences, and support injected sanitizer documents in Node without browser globals.

  Reconcile SSR-seeded structural arrays without duplicate children, keep mixed keyed moves and updates in final-data order, refresh top-level and nested template metadata, and preflight the complete nested tree so invalid deep markup cannot partially mutate live DOM. Create structural roots through their container document. Built-in no-write paths no longer emit successful update events, while existing custom renderer and scheduler callback return values retain their 1.x semantics.

  Roll back partial runtime startup across observers, message listeners, caches, accessibility leases, ready timers, and inline global-handle publication so transient browser failures can be retried on the same runtime or client; contain later ready-retry transport failures.

  Make timers, animation frames, observers, message listeners, accessibility nodes, and merge attempts retain exact ownership across ineffective cancellation and re-entrant host callbacks. Stale callbacks can no longer clear or publish newer work, and hostile or asynchronous consumer callbacks remain fail-soft without escaping as unhandled rejections.

  Keep consumer installs free of package lifecycle build scripts, preserve the established 1.0.x inline-runtime presence marker, and add isolated strict exact-tarball, export, CLI, type, bundle, and release-after-CI gates that cannot inherit maintainer dependencies; remove unreachable CommonJS artifacts and redundant built-in registrations.

  Minify the narrow `core` entry independently while retaining every callable public export name, declaration, source map, and ESM/CJS condition; the bundle gate now verifies that full callable namespace instead of a hand-picked subset.

  Turn the test environment into an executable quality contract: fail on flaky, skipped, focused, conditional, retried, repeated, or stale-inventory tests; ratchet global, critical-file, and changed-line coverage; enforce dependency layers, cycles, dead code, immutable workflow actions, and exact release-job requirements. Validate the exact package archive with API Extractor reports, positive and negative NodeNext type contracts, publint, ATTW, declaration-condition parity, isolated consumers, and a reviewed public-type-debt ratchet.

  Promote the exact CI-verified npm archive instead of rebuilding at publish time. Bind it to a reproducible commit timestamp and a digest/content manifest, recheck the downloaded workflow artifact, and verify the registry-served bytes before creating the release tag.

  Add Stryker mutation profiles and deterministic fast-check security/lifecycle models, including scheduled high-volume exploration. Add CodSpeed trend collection, WCAG 2.2 AA Axe checks, a 10,000-update forced-GC Node resource gate, and a sustained Chromium update/heap soak, with all expensive exploratory checks separated from the deterministic pull-request lane.

## 1.0.3

### Patch Changes

- Real-Payload protocol coverage + validation robustness.

  - **New contract test** (`tests/integration/real-payload-protocol.test.ts`)
    runs a message captured **verbatim from a running Payload 3.85 admin**
    through the real MessageBus + runtime, asserting text, rich-text
    (real Lexical) and array rendering. This closes the gap the emulated
    E2E fixture left open — "does the runtime handle the shape Payload
    actually sends?" — and documents the layered protocol coverage in the
    README.
  - **Guard robustness:** optional scalar fields now treat `null` the same
    as absent. A real global sends `collectionSlug: undefined`; a JSON
    round-trip or proxy can turn that into `null`. Both are accepted
    rather than dropped as malformed.

## 1.0.2

### Patch Changes

- Hardening from an external code review — closes five real gaps where
  the implementation was weaker than its own comments/docs claimed:

  - **Message validation is now genuinely strict.** A `payload-live-preview`
    message whose `data` is a non-object (string/array/number) was
    previously accepted; a full per-type guard now rejects it (and
    wrongly-typed scalar fields) as `onInvalid('shape')`. The runtime
    enforces `data?: Record<string, unknown>` instead of only asserting it.
  - **Async preview-token validation is serialised in arrival order.**
    Verdicts were dispatched independently, so a slower validation could
    let a later update overtake an earlier one. They now run through a
    single ordered chain.
  - **`destroy()` clears `window.__livePreview`.** It was left pointing at
    the dead API, so a later `bootstrapInlineRuntime()` returned the
    destroyed instance and never restarted. The handle is now removed on
    destroy, so re-bootstrap starts a fresh runtime.
  - **Structural-diff state is genuinely per-instance.** The
    `structural-array` renderer's diff memory (previous values + nested
    store + warning set) moved from module-level `WeakMap`s into
    per-`buildBuiltinRenderers()` closures, so two clients never share
    state and a destroyed client leaves nothing at module scope — making
    the "no module-level singletons" guarantee literally true.
  - **Docs aligned to the code.** The message-bus, structural-applier and
    README/security claims now describe exactly what the implementation
    does.

  No public API changes. New regression tests cover each fix (malformed
  `data` drop, out-of-order async-validation ordering, destroy→rebootstrap,
  and two-instance diff isolation).

## 1.0.1

### Patch Changes

- Provenance-signed maintenance release. No runtime changes since 1.0.0 —
  1.0.0 was published locally (without provenance) to bootstrap the
  package; this release is published through the GitHub Actions pipeline
  with a signed provenance attestation ("published via GitHub Actions" on
  npm) and verifies the automated release chain end-to-end. The CI test
  matrix now also covers Node 26.

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
  - Astro peer range is now `>=4.0.0 <8.0.0`. The maintained real-app
    browser fixture currently exercises Astro 7; the peer range is broader
    than that single-major E2E fixture.

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
    `fetchPreviewGlobal()` wrap the REST query with draft, depth, locale and
    auth headers. Security clarification: `isPreviewRequest()` detects only
    client-controlled preview intent. Authorize the request with an
    application-owned session or short-lived scoped signature, then pass
    `draft: authorization !== null` and only that authorization's minimum
    request-scoped credentials.
  - **Astro integration `mode: 'middleware'`**: auto-registers the
    preview middleware via `addMiddleware()` + a virtual options module —
    request-time, preview-intent-gated injection for `output: 'server'`
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
