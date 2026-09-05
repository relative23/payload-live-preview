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
| `fragmentEndpoint`         | —      | yes           | as `fragments: { endpoint }`, Astro                      | —                        | — (no fragment client)                              | same                                 |
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
| `mode`                     | —      | —             | Astro integration only                                   | —                        | `'inline'`                                          | same                                 |
| `nonce`                    | —      | —             | render helpers only                                      | —                        | —                                                   | same                                 |

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
- `mode` (Astro): `'inline'` bakes the runtime into every page at build time;
  `'loader'` injects a small bootstrap that fetches the runtime as a hashed,
  SRI-verified asset only inside a preview; `'middleware'` registers the
  request-time middleware from serialized options, so it cannot carry
  `authorizePreview` or `shouldInject` and refuses the `strict` default —
  register `createLivePreviewMiddleware()` yourself for those. The loader
  asset's caching and CSP are in
  [docs/deployment.md](deployment.md#the-loader-asset-astro-mode-loader).
- `manageCsp: 'full'` also manages a nonce'd `script-src`; `strictDynamic`
  adds `'strict-dynamic'`, after which CSP 3 ignores `'self'` and host
  sources, so every script on the page must carry the nonce.
- `fragmentEndpoint` / `fragments` put the fragment client ahead of the runtime
  in the injected script; the other adapters' option types do not carry it.
  `LivePreviewClient` takes `strategies` instead ([docs/hybrid.md](hybrid.md)).
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
fields arrive as bare ids. With `serverURL` set, the runtime re-fetches each
update through the Payload REST API (`POST` with
`X-Payload-HTTP-Method-Override: GET`, `credentials: 'include'` — the same
request the official client makes) and renders the populated document; on
failure it renders the raw values. `mergeDepth` has no default: every
adapter, `generateInlineScript()` and `LivePreviewClient` throw when
`serverURL` is set without it (`0` means no population), and `defaults: 'v1'`
restores the 1.x default of `1`. The depth must match the `depth` of the
initial page fetch, or nested relationships that were objects on first load
degrade to ids after the first edit. `definePreview({ serverURL, depth })`
binds both once: spread its `runtimeOptions` (`serverURL`, `apiRoute`,
`mergeDepth`) into the adapter. The preview page must reach the Payload API
with the editor's credentials — same-site cookies, or CORS with credentials
([docs/authorization.md](authorization.md)).
