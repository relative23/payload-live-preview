# Options

One table for every option, and where it is accepted. The columns are the
four places configuration enters: the programmatic client
(`LivePreviewClient` / `initLivePreview()`), the inline script
(`generateInlineScript()` and `generateLoaderScript()`), the adapter option
objects (`livePreview()`, `createLivePreviewMiddleware()`,
`livePreviewHandle()`, `livePreviewNitroPlugin()`,
`defineLivePreviewServerHandler()`, the render helpers) and the server read
(`definePreview()`). The adapters serialize what they are given into the
inline script, so an adapter row is also an inline-script row.

The defaults are the `v2` table. `defaults: 'v1'` restores every 1.x row at
once on the client, the inline script and the adapters; an explicit option
always wins. The ledger of what changed is
[ADR 0007 — 2.0 defaults, migration policy, and the renames ledger](architecture/0007-v2-defaults-and-renames-ledger.md).

| Option                     | Client | Inline script | Adapter                                                  | Server (`definePreview`) | Default (v2)                                        | With `defaults: 'v1'`                |
| -------------------------- | ------ | ------------- | -------------------------------------------------------- | ------------------------ | --------------------------------------------------- | ------------------------------------ |
| `allowedOrigins`           | yes    | yes           | yes; non-empty and `https:` in production under `strict` | —                        | `[]`                                                | same                                 |
| `serverURL`                | yes    | yes           | yes                                                      | yes, required            | — (no REST merge)                                   | same                                 |
| `apiRoute`                 | yes    | yes           | yes                                                      | yes                      | `/api`                                              | same                                 |
| `mergeDepth`               | yes    | yes           | yes                                                      | as `depth`, required     | — (required with `serverURL`; `0` for none)         | `1`                                  |
| `mergeFetch`               | yes    | —             | —                                                        | as `fetch`               | global `fetch`                                      | same                                 |
| `timeoutMs`                | —      | —             | —                                                        | yes                      | `5000` (floor `250`)                                | same                                 |
| `onDiagnostic`             | —      | —             | —                                                        | yes                      | —                                                   | same                                 |
| `debug`                    | yes    | yes           | yes                                                      | —                        | client: dev detection; inline and adapters: `false` | same                                 |
| `debounceMs`               | yes    | yes           | yes                                                      | —                        | `50`                                                | same                                 |
| `heartbeatMs`              | yes    | yes           | yes                                                      | —                        | `0` (off; the admin sends no keepalive)             | same                                 |
| `enableA11y`               | yes    | yes           | —                                                        | —                        | `true`                                              | same                                 |
| `a11yLocale`               | yes    | —             | —                                                        | —                        | detected locale                                     | same                                 |
| `disableVisibilityGate`    | yes    | yes           | —                                                        | —                        | `false`                                             | same                                 |
| `visibilityGateThreshold`  | yes    | yes           | —                                                        | —                        | `50` bindings                                       | same                                 |
| `intersectionRootMargin`   | yes    | yes           | —                                                        | —                        | `'200px'`                                           | same                                 |
| `skipUnchanged`            | yes    | yes           | yes                                                      | —                        | `true`                                              | `false`                              |
| `dependencies`             | yes    | —             | —                                                        | —                        | `{}`                                                | same                                 |
| `revealEditedField`        | yes    | yes           | yes                                                      | —                        | `false`                                             | same                                 |
| `scopeBindingsByOwner`     | yes    | yes           | yes                                                      | —                        | `false`                                             | same                                 |
| `sanitizerPolicy`          | yes    | yes           | yes                                                      | —                        | `'strict'`                                          | `'compat'`                           |
| `eventSourcePolicy`        | yes    | yes           | yes                                                      | —                        | `'parent-or-opener'`                                | `'any'`                              |
| `disableReferrerDetection` | yes    | yes           | yes                                                      | —                        | `true`                                              | `false`                              |
| `disableLocalhostMatching` | yes    | yes           | yes                                                      | —                        | `false`                                             | same                                 |
| `strategies`               | yes    | —             | —                                                        | —                        | — (patch only)                                      | same                                 |
| `fragmentEndpoint`         | —      | yes           | as `fragments: { endpoint }`                             | —                        | — (no fragment client)                              | same                                 |
| `routeStrategy`            | —      | yes           | yes                                                      | —                        | `false`                                             | same                                 |
| `onUnfaithfulPatch`        | —      | yes           | yes                                                      | —                        | `'escalate'`                                        | same                                 |
| `onUnboundChange`          | —      | yes           | yes                                                      | —                        | — (alias, deprecated)                               | same                                 |
| `autoBind`                 | yes    | yes           | yes                                                      | —                        | `'off'`                                             | same                                 |
| `hydration`                | —      | yes           | set by the Next.js and Nuxt adapters                     | —                        | — (start on `DOMContentLoaded`)                     | same                                 |
| `resolveRenderer`          | yes    | —             | —                                                        | —                        | —                                                   | same                                 |
| `renderRichText`           | yes    | —             | —                                                        | —                        | built-in Lexical renderer                           | same                                 |
| `root`                     | yes    | —             | —                                                        | —                        | `document`                                          | same                                 |
| `autoStart`                | yes    | —             | —                                                        | —                        | `true`                                              | same                                 |
| `validateToken`            | yes    | —             | —                                                        | —                        | — (stock Payload sends no token)                    | same                                 |
| `defaults`                 | yes    | yes           | yes                                                      | —                        | `'v2'`                                              | `'v1'`                               |
| `strict`                   | —      | —             | yes                                                      | —                        | `true`                                              | `false`                              |
| `authorizePreview`         | —      | —             | yes                                                      | —                        | — (required under `strict`)                         | same                                 |
| `previewSignals`           | —      | —             | yes                                                      | —                        | `['query']`                                         | `['query', 'fetch-dest', 'referer']` |
| `previewQueryParams`       | —      | —             | yes                                                      | —                        | `['preview', 'draft', 'livePreview']`               | same                                 |
| `inject`                   | —      | —             | yes                                                      | —                        | `'preview-only'`                                    | same                                 |
| `autoInject`               | —      | —             | yes                                                      | —                        | `true`                                              | same                                 |
| `shouldInject`             | —      | —             | yes (not Astro `mode: 'middleware'`)                     | —                        | — (inject on every preview response)                | same                                 |
| `manageCsp`                | —      | —             | yes                                                      | —                        | `'frame-ancestors'` (`true` is an alias)            | same                                 |
| `strictDynamic`            | —      | —             | yes                                                      | —                        | `false`                                             | same                                 |
| `frameAncestorsExtra`      | —      | —             | yes                                                      | —                        | `[]`                                                | same                                 |
| `scriptSrcExtra`           | —      | —             | yes                                                      | —                        | `[]`                                                | same                                 |
| `delivery`                 | —      | —             | yes (Astro uses `mode`)                                  | —                        | `'inline'`                                          | same                                 |
| `assetPath`                | —      | —             | yes, with `delivery: 'asset'`                            | —                        | `/payload-live-preview`                             | same                                 |
| `mode`                     | —      | —             | Astro integration only                                   | —                        | `'inline'`                                          | same                                 |
| `nonce`                    | —      | —             | render helpers only                                      | —                        | —                                                   | same                                 |

### Why each of these exists

Every option is a decision someone had to be able to make differently. Grouped
by the decision, so the table above can be read as eight questions rather than
forty-six rows.

- **Which document, and how complete** — `allowedOrigins`, `serverURL`,
  `apiRoute`, `mergeDepth`, `mergeFetch`. Payload 3.x posts raw form values, so
  a relationship arrives as an id; re-fetching through the REST API is the only
  way to show the populated document, and it needs an origin, a route and an
  explicit depth ([below](#serverurl-and-mergedepth)).
- **May this request see a preview** — `previewSignals`, `previewQueryParams`,
  `inject`, `authorizePreview`, `strict`. Intent is client-controlled and
  authorization is not; both exist because collapsing them into one option is
  exactly the mistake this package is built to avoid
  ([ADR 0006](architecture/0006-authorized-preview-context.md)).
- **How the runtime reaches the page** — `autoInject`, `shouldInject`,
  `delivery`, `assetPath`, `mode`, `runtime`, `nonce`, and `hydration`, for a
  page a framework takes over after it is parsed. A site that renders the
  tag itself, one that serves the runtime as a cached asset, and one that ships
  a smaller build all need a different answer, and the wrong default costs
  every visitor bytes ([deployment.md](deployment.md#what-a-public-visitor-pays)).
- **What the response's CSP says** — `manageCsp`, `strictDynamic`,
  `frameAncestorsExtra`, `scriptSrcExtra`. The admin has to be allowed to frame
  the page and the injected script has to be allowed to run, without the package
  ever loosening a policy the site already sends.
- **How an update reaches an element** — `fragmentEndpoint` / `fragments`,
  `routeStrategy`, `onUnfaithfulPatch`, `strategies`, `dependencies`,
  `autoBind`. Three strategies exist because patching cannot create markup and
  a route refresh cannot be done per keystroke
  ([overview](architecture/overview.md#the-five-objects)); `autoBind` is how a
  page with no `data-payload-field` at all gets its bindings.
- **What the page does with a value** — `sanitizerPolicy`, `resolveRenderer`,
  `renderRichText`, `revealEditedField`, `scopeBindingsByOwner`. Unsaved editor
  input is untrusted input; the rest is how a site renders what it already
  trusts.
- **Which sender is believed** — `eventSourcePolicy`,
  `disableReferrerDetection`, `disableLocalhostMatching`, `validateToken`. A
  page inside an iframe can be addressed by anything that framed it, and each of
  these narrows who counts as the admin.
- **Cost and noise** — `debounceMs`, `heartbeatMs`, `skipUnchanged`,
  `disableVisibilityGate`, `visibilityGateThreshold`, `intersectionRootMargin`,
  `enableA11y`, `a11yLocale`, `debug`, `timeoutMs`, `onDiagnostic`, `root`,
  `autoStart`, `defaults`. Typing produces dozens of messages a second; these
  decide how much work each one causes, how much of it is announced to a screen
  reader, and how loudly the runtime reports what it did.

Notes on the rows that need one:

- `strict` refuses at startup, not on a public response: it requires
  `authorizePreview`, explicit `https:` `allowedOrigins` outside development,
  and no `'referer'` in the resolved `previewSignals`.
- `authorizePreview` runs on requests carrying preview intent. Only a context
  produced by `authorizePreviewRequest()` authorizes; anything else — a
  `{ authorized: true }` literal, a copy, `null` — refuses, and a refusal
  leaves the response as rendered: no runtime, no CSP change, no nonce.
  [docs/authorization.md](authorization.md) has the strategies.
- `previewSignals` and `previewQueryParams` are intent, not authorization.
  `inject: 'always'` treats every request as intent, so the hook runs on each.
- `shouldInject` filters script injection only; it never suppresses CSP
  handling. `autoInject: false` keeps CSP management and lets you place the
  tag with `renderLivePreviewScript()` (Astro, Next.js, Nuxt).
- `delivery: 'asset'` replaces the inlined runtime with a bootstrap of a few
  hundred bytes that fetches it as `<assetPath>/runtime.<hash>.js` — but only
  once it finds itself in a preview context. Measured on the Next.js fixture by
  `tests/e2e/specs/public-response.spec.ts`: 1 326 bytes in the page (605 of
  them the arming for React's first commit a Next page needs, ADR 0015)
  instead of 115 031, and one response the browser may
  keep for a year, because the file name is the hash of its contents. It needs
  the asset route mounted, which each adapter page shows; the caching, the
  integrity check and what a proxy must not do to the file are in
  [docs/deployment.md](deployment.md#the-runtime-as-a-cached-asset).
- `mode` (Astro): `'inline'` bakes the runtime into every page at build time;
  `'loader'` injects a small bootstrap that fetches the runtime as a hashed,
  SRI-verified asset only inside a preview; `'middleware'` registers the
  request-time middleware from serialized options, so it cannot carry
  `authorizePreview` or `shouldInject` and refuses the `strict` default —
  register `createLivePreviewMiddleware()` yourself for those. The loader
  asset's caching and CSP are in
  [docs/deployment.md](deployment.md#the-runtime-as-a-cached-asset).
- `manageCsp: 'full'` also manages a nonce'd `script-src`; `strictDynamic`
  adds `'strict-dynamic'`, after which CSP 3 ignores `'self'` and host
  sources, so every script on the page must carry the nonce.
- `runtime` chooses which artifact the page carries. The default is the full
  one; `LEAN_RUNTIME` from `payload-live-preview/lean` is 24 763 bytes gzip
  against 30 253 — it leaves out the fragment and route strategies, the keyed
  morph, the structural arrays, the item templates, the screen-reader
  announcer and auto-binding, and reports LP0104 when a page needs one of them
  rather than doing nothing. It is an import rather than a string option so the second artifact
  lands only in builds that ask for it:

  ```ts
  import { LEAN_RUNTIME } from 'payload-live-preview/lean';

  livePreview({ runtime: LEAN_RUNTIME, allowedOrigins: [ADMIN] });
  ```

  The strategies and the lean runtime exclude each other, and the generator says
  so rather than emitting a prelude with nothing to talk to.

- `fragmentEndpoint` / `fragments` put the fragment client ahead of the runtime
  in the injected script. Every adapter takes `fragments`: the option names a
  same-origin path the runtime posts to, and which framework serves that path
  is the endpoint's business, not the option's. `LivePreviewClient` takes
  `strategies` instead ([docs/hybrid.md](hybrid.md)).
- `routeStrategy` puts the route strategy alone ahead of the runtime, for a page
  that wants a route refresh without a fragment endpoint. `fragmentEndpoint`
  implies it and the two are never emitted together, because the fragment
  prelude already carries the route strategy.
- `onUnfaithfulPatch` decides what happens when the runtime knows a patch cannot
  reach what the server would have drawn: a value no renderer can represent, a
  Lexical block whose markup the write has to drop, or a changed field the page
  has no binding for at all. `'escalate'`, the default, hands the region to the
  fragment strategy when a boundary covers it and to the route otherwise, so it
  does nothing without `fragments` or `routeStrategy`; `'warn'` reports LP0411
  and keeps the patch; `'ignore'` keeps it silently. It skips the connection's
  first message, where every field counts as changed and the page has just been
  rendered from them ([docs/hybrid.md](hybrid.md#a-change-nothing-binds)).
  `inspect().fidelity` counts the findings under every mode — `unfaithful`,
  and `escalated` for the ones a strategy took — so a page that has nowhere to
  escalate to shows the gap rather than hiding it.
  `onUnboundChange` is the 2.0 name for the same decision and still decides when
  it is given — `'route'` means `'escalate'` — until it is removed in 3.0.
- `hydration: 'react'` holds the runtime's start — no `ready`, no listener —
  until React has committed the tree that holds the bindings, so the first
  write lands on markup React keeps instead of on markup React is about to
  compare with its own render and regenerate
  ([ADR 0015](architecture/0015-first-write-after-hydration.md)). The Next.js
  adapter sets it on every script it emits. `hydration: 'vue'` holds it until
  Vue has mounted the app around the bindings — and, on Nuxt, until a Suspense
  still hydrating at the mount has resolved — so the write is not repaired
  back to the server's value by Vue's hydration; the Nuxt adapter sets it. A
  page built by hand with `generateInlineScript()` may set either. Capped at
  five seconds, then `LP0607`.
- `autoBind: 'unique'` lets the runtime find bindings by value on the
  connection's first message, once: a scalar whose value is the whole content
  of exactly one element in the body is bound to that element as if
  `data-payload-field` stood there, and everything else stays unbound. A
  route refresh keeps those guesses — the fresh markup is searched for them
  again, and for nothing else. A
  declared attribute always wins, `data-payload-no-bind` keeps a subtree out,
  and every guess is stamped `data-payload-guessed` and listed in
  `inspect().bindings.guessed`. Off by default; what it finds and what it must
  never find are in [docs/bindings.md](bindings.md#letting-the-runtime-find-bindings-by-value)
  and [ADR 0014](architecture/0014-auto-binding.md).
- `debounceMs` is the window a burst of messages shares, not a delay on every
  one: the first write of a quiet phase is applied on the next animation frame
  and opens the window, and everything that arrives inside it is coalesced into
  one flush when it closes. Typing therefore costs one frame at the start of a
  phrase and one at the end of it, not 50 ms per keystroke. `debounceMs: 0`
  removes the window entirely — and with it the merge coalescing that shares it.
- `dependencies` and `data-payload-depends` say the same thing from two sides;
  both matter only under `skipUnchanged`. `revealEditedField` is described in
  [docs/reveal.md](reveal.md), `scopeBindingsByOwner` in
  [docs/bindings.md](bindings.md).

## What the adapters publish per request

The Astro middleware, the SvelteKit handle and the Nuxt server handler or
plugin write three optional keys on the request context — `Astro.locals`,
`event.locals`, `event.context` — typed by `LivePreviewLocals`, exported from
`payload-live-preview/astro`, `payload-live-preview/sveltekit` and
`payload-live-preview/nuxt`:

| Key                               | Set when                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `livePreviewNonce`                | Every request except a preview the hook refused                               |
| `livePreviewAuthorization`        | The hook authorized an intent-bearing request; the `AuthorizedPreviewContext` |
| `livePreviewAuthorizationOutcome` | The hook ran at all; `'authorized'` or the refusal outcome                    |

Next.js middleware has no request context; call `authorizePreviewRequest()`
in the route when a page needs the authorization.

## Package entries

The root import carries everything. The focused entries ship the same code as
smaller, self-contained bundles with their own type declarations. The
adapters, `codegen/astro`, `doctor`, `migrate` and the `.astro` components
are ESM-only; the rest ship ESM and CommonJS builds.

| Entry                                                | Contents                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `payload-live-preview`                               | Everything: client, inline script generator, renderers, plugins, authorization, server helpers.             |
| `payload-live-preview/core`                          | The client and runtime without the built-in plugin constructors, generator or adapters.                     |
| `payload-live-preview/client`                        | `LivePreviewClient` and `initLivePreview()` alone.                                                          |
| `payload-live-preview/structural`                    | The structural array renderer, the keyed morph and the `data-payload-depends` helpers.                      |
| `payload-live-preview/lexical`                       | `lexicalToHtml()`, `lexicalToPlainText()`, `registerLexicalNode()`, `registerBlockRenderer()`.              |
| `payload-live-preview/plugins`                       | `PluginManager`, plugin types and the built-in plugins.                                                     |
| `payload-live-preview/fragment`                      | `createFragmentStrategy()` and `createRouteStrategy()`: the browser half of fragment boundaries.            |
| `payload-live-preview/server`                        | `definePreview()`, `authorizePreviewRequest()`, `issuePreviewToken()`, `createPreviewBindings()`, `bind()`. |
| `payload-live-preview/payload`                       | `buildLivePreviewUrl()` for `payload.config.ts`; imports nothing from `payload`.                            |
| `payload-live-preview/{astro,nextjs,sveltekit,nuxt}` | One framework adapter each.                                                                                 |
| `payload-live-preview/react`                         | `useLivePreviewDocument()`: the merged document as a hook (needs `react`).                                  |
| `payload-live-preview/vue`                           | The same as a composable (needs `vue`).                                                                     |
| `payload-live-preview/lean`                          | `LEAN_RUNTIME`: the smaller runtime artifact, as a value for the `runtime` option.                          |
| `payload-live-preview/annotate`                      | `livePreviewAnnotate()`: the build-time annotator as a Vite plugin. No `ts-morph`.                          |
| `payload-live-preview/astro/RichText.astro`          | The `RichText` component.                                                                                   |
| `payload-live-preview/astro/PreviewBoundary.astro`   | The `PreviewBoundary` component.                                                                            |
| `payload-live-preview/codegen`                       | Type generation from a Payload config (needs `ts-morph`).                                                   |
| `payload-live-preview/codegen/astro`                 | `livePreviewCodegen()`: the Astro integration that runs that generation on start and in `astro dev`.        |
| `payload-live-preview/doctor`                        | `runDoctor()` and `analyzeProbe()`: the `pll doctor` checks as a library.                                   |
| `payload-live-preview/migrate`                       | `migrateSource()` and the codemods behind `pll migrate` (needs `ts-morph`).                                 |

`payload-live-preview/astro/middleware-entry` also exists; Astro's
`mode: 'middleware'` registers it and nothing else imports it.

## `serverURL` and `mergeDepth`

Payload 3.x posts raw form values on every edit, so relationship and upload
fields arrive as bare ids. With `serverURL` set, the runtime re-fetches the
update through the Payload REST API (`POST` with
`X-Payload-HTTP-Method-Override: GET`, `credentials: 'include'` — the same
request the official client makes) and renders the populated document; on
failure it renders the raw values.

It asks only when the answer can change what the page shows. A page whose every
binding renders a plain scalar of a top-level field, and a page with no binding,
no island, no `data-payload-fragment` boundary and no `beforeUpdate`/`afterUpdate`
listener, never merge at all; a message that moved no field anything populates is
answered from its own values over the document the last merge resolved. What is
left costs one request that opens a burst of edits and one that closes it — the
window is `debounceMs`, and `debounceMs: 0` turns it off. A field that names a
document keeps the value the last merge resolved until the new one arrives, so a
bare id never reaches the page. One consequence worth knowing: on a page that
reads no populated value, an `afterRead` hook that rewrites a scalar no longer
reaches the preview between saves. `mergeDepth` has no default: every
adapter, `generateInlineScript()` and `LivePreviewClient` throw when
`serverURL` is set without it (`0` means no population), and `defaults: 'v1'`
restores the 1.x default of `1`. The depth must match the `depth` of the
initial page fetch, or nested relationships that were objects on first load
degrade to ids after the first edit. `definePreview({ serverURL, depth })`
binds both once: spread its `runtimeOptions` (`serverURL`, `apiRoute`,
`mergeDepth`) into the adapter. The preview page must reach the Payload API
with the editor's credentials — same-site cookies, or CORS with credentials
([docs/authorization.md](authorization.md)).
