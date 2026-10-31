# Options

One table for every option, and where it is accepted. The columns are the
four places configuration enters: the programmatic client
(`LivePreviewClient` / `initLivePreview()`), the inline script
(`generateInlineScript()`, or the loader an adapter emits in its place under
`delivery: 'asset'` or Astro's `mode: 'loader'`), the adapter option
objects (`livePreview()`, `createLivePreviewMiddleware()`,
`livePreviewHandle()`, `livePreviewNitroPlugin()`,
`defineLivePreviewServerHandler()`, the render helpers) and the server read
(`definePreview()`). The adapters serialize what they are given into the
inline script, so an adapter row is also an inline-script row.

The defaults are the `v2` table. `defaults: 'v1'` restores every 1.x row at
once on the client, the inline script and the adapters; an explicit option
always wins. It is deprecated: 3.0 removes it, an adapter given it warns once
in development, and `pll migrate` writes the rows it stands for into the
options ([ADR 0026](architecture/0026-deprecations-warn-before-3-0.md)). The ledger of what changed is
[ADR 0007 — 2.0 defaults, migration policy, and the renames ledger](architecture/0007-v2-defaults-and-renames-ledger.md).

| Option                     | Client | Inline script | Adapter                                                             | Server (`definePreview`) | Default (v2)                                        | With `defaults: 'v1'`                |
| -------------------------- | ------ | ------------- | ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------- | ------------------------------------ |
| `allowedOrigins`           | yes    | yes           | yes; `strict` needs it non-empty, `https:` in production            | —                        | `[]`                                                | same                                 |
| `serverURL`                | yes    | yes           | yes                                                                 | yes, required            | — (no REST merge)                                   | same                                 |
| `apiRoute`                 | yes    | yes           | yes                                                                 | yes                      | `/api`                                              | same                                 |
| `mergeDepth`               | yes    | yes           | yes                                                                 | as `depth`, required     | — (required with `serverURL`; `0` for none)         | `1`                                  |
| `mergeTimeoutMs`           | yes    | yes           | yes                                                                 | —                        | off                                                 | same                                 |
| `mergeFetch`               | yes    | —             | —                                                                   | as `fetch`               | global `fetch`                                      | same                                 |
| `timeoutMs`                | —      | —             | —                                                                   | yes                      | `5000` (floor `250`)                                | same                                 |
| `onDiagnostic`             | —      | —             | —                                                                   | yes                      | —                                                   | same                                 |
| `debug`                    | yes    | yes           | yes                                                                 | —                        | client: dev detection; inline and adapters: `false` | same                                 |
| `debounceMs`               | yes    | yes           | yes                                                                 | —                        | `50`                                                | same                                 |
| `heartbeatMs`              | yes    | yes           | yes                                                                 | —                        | `0` (off; the admin sends no keepalive)             | same                                 |
| `enableA11y`               | yes    | yes           | —                                                                   | —                        | `true`                                              | same                                 |
| `a11yLocale`               | yes    | —             | —                                                                   | —                        | detected locale                                     | same                                 |
| `disableVisibilityGate`    | yes    | yes           | yes                                                                 | —                        | `false`                                             | same                                 |
| `visibilityGateThreshold`  | yes    | yes           | yes                                                                 | —                        | `50` bindings                                       | same                                 |
| `intersectionRootMargin`   | yes    | yes           | —                                                                   | —                        | `'200px'`                                           | same                                 |
| `skipUnchanged`            | yes    | yes           | yes                                                                 | —                        | `true`                                              | `false`                              |
| `dependencies`             | yes    | —             | —                                                                   | —                        | `{}`                                                | same                                 |
| `revealEditedField`        | yes    | yes           | yes                                                                 | —                        | `false`                                             | same                                 |
| `scopeBindingsByOwner`     | yes    | yes           | yes                                                                 | —                        | `false`                                             | same                                 |
| `sanitizerPolicy`          | yes    | yes           | yes                                                                 | —                        | `'strict'`                                          | `'compat'`                           |
| `eventSourcePolicy`        | yes    | yes           | yes                                                                 | —                        | `'parent-or-opener'`                                | `'any'`                              |
| `disableReferrerDetection` | yes    | yes           | yes                                                                 | —                        | `true`                                              | `false`                              |
| `disableLocalhostMatching` | yes    | yes           | yes                                                                 | —                        | `false`                                             | same                                 |
| `strategies`               | yes    | —             | —                                                                   | —                        | — (patch only)                                      | same                                 |
| `fragmentEndpoint`         | —      | yes           | as `fragments: { endpoint }`                                        | —                        | — (no fragment client)                              | same                                 |
| `routeStrategy`            | —      | yes           | yes                                                                 | —                        | `false`                                             | same                                 |
| `onUnfaithfulPatch`        | —      | yes           | yes                                                                 | —                        | `'escalate'`                                        | same                                 |
| `onUnboundChange`          | —      | yes           | yes                                                                 | —                        | — (alias, deprecated)                               | same                                 |
| `autoBind`                 | yes    | yes           | yes                                                                 | —                        | `'off'`                                             | same                                 |
| `subfieldCoverage`         | yes    | yes           | yes                                                                 | —                        | `'descendant'`                                      | same                                 |
| `hydration`                | —      | yes           | `'manual'`; the Next.js, Nuxt and SvelteKit adapters set the others | —                        | — (start on `DOMContentLoaded`)                     | same                                 |
| `softNavigationEvents`     | —      | yes           | set by Astro, Next.js, SvelteKit and Nuxt                           | —                        | `[]`                                                | same                                 |
| `resolveRenderer`          | yes    | —             | —                                                                   | —                        | —                                                   | same                                 |
| `renderRichText`           | yes    | —             | —                                                                   | —                        | built-in Lexical renderer                           | same                                 |
| `root`                     | yes    | —             | —                                                                   | —                        | `document`                                          | same                                 |
| `autoStart`                | yes    | —             | —                                                                   | —                        | `true`                                              | same                                 |
| `validateToken`            | yes    | —             | —                                                                   | —                        | — (stock Payload sends no token)                    | same                                 |
| `defaults`                 | yes    | yes           | yes                                                                 | —                        | `'v2'`                                              | `'v1'`                               |
| `strict`                   | —      | —             | yes                                                                 | —                        | `true`                                              | `false`                              |
| `authorizePreview`         | —      | —             | yes (not Astro's `livePreview()` or the Nuxt module)                | —                        | — (required under `strict`)                         | same                                 |
| `authorizePreviewModule`   | —      | —             | Astro `mode: 'middleware'`, the Nuxt module                         | —                        | — (the hook by reference, ADR 0024)                 | same                                 |
| `previewSignals`           | —      | —             | yes                                                                 | —                        | `['query']`                                         | `['query', 'fetch-dest', 'referer']` |
| `previewQueryParams`       | —      | —             | yes                                                                 | —                        | `['preview', 'draft', 'livePreview']`               | same                                 |
| `inject`                   | —      | —             | yes                                                                 | —                        | `'preview-only'`                                    | same                                 |
| `autoInject`               | —      | —             | yes                                                                 | —                        | `true`                                              | same                                 |
| `shouldInject`             | —      | —             | yes (not Astro's `livePreview()` or the Nuxt module)                | —                        | — (inject on every preview response)                | same                                 |
| `manageCsp`                | —      | —             | yes                                                                 | —                        | `'frame-ancestors'` (`true` is an alias)            | same                                 |
| `strictDynamic`            | —      | —             | yes                                                                 | —                        | `false`                                             | same                                 |
| `frameAncestorsExtra`      | —      | —             | yes                                                                 | —                        | `[]`                                                | same                                 |
| `scriptSrcExtra`           | —      | —             | yes                                                                 | —                        | `[]`                                                | same                                 |
| `delivery`                 | —      | —             | yes (Astro uses `mode`)                                             | —                        | `'inline'`                                          | same                                 |
| `assetPath`                | —      | —             | yes, with `delivery: 'asset'`                                       | —                        | `/payload-live-preview`                             | same                                 |
| `mode`                     | —      | —             | Astro integration only                                              | —                        | `'inline'`                                          | same                                 |
| `runtime`                  | —      | yes           | yes                                                                 | —                        | — (the full runtime)                                | same                                 |
| `nonce`                    | —      | —             | render helpers only                                                 | —                        | —                                                   | same                                 |

Three option objects outside these four places have options of their own.
`useLivePreviewDocument()` from `/react` and `/vue` takes `initialData` and
`serverURL` (both required) and names some rows differently: `depth` (`1`),
`enableReferrerDetection` (`false`), `enableLocalhostMatching` (`true`)
([docs/react.md](react.md#the-hook)).
`withLivePreview()` in `next.config.ts` takes `allowedOrigins` (required,
non-empty), `previewQueryParams` (`['preview', 'draft', 'livePreview']`) and
`allowDevOrigins` (`true`) ([docs/nextjs.md](nextjs.md#headers-on-preview-requests)).
`createFragmentEndpoint()` takes `registry`, `authorizePreview` or `authorize`
(exactly one of the two), `render`, `allowedOrigins` and `limits`
(`bodyBytes`, `timeoutMs`, `fieldDepth`, `totalTimeoutMs`)
([docs/hybrid.md](hybrid.md#what-both-decide)). The Payload config plugin has
its own table [below](#payload-config-plugin).

### Why each of these exists

Every option is a decision someone had to be able to make differently. Grouped
by the decision, so the table above can be read as eight questions rather than
fifty-five rows.

- **Which document, and how complete** — `allowedOrigins`, `serverURL`,
  `apiRoute`, `mergeDepth`, `mergeFetch`. Payload 3.x posts raw form values, so
  a relationship arrives as an id; re-fetching through the REST API is the only
  way to show the populated document, and it needs an origin, a route and an
  explicit depth ([below](#serverurl-and-mergedepth)).
- **May this request see a preview** — `previewSignals`, `previewQueryParams`,
  `inject`, `authorizePreview`, `authorizePreviewModule`, `strict`. Intent is
  client-controlled and authorization is not; both exist because collapsing
  them into one option is exactly the mistake this package is built to avoid
  ([ADR 0006](architecture/0006-authorized-preview-context.md)).
- **How the runtime reaches the page** — `autoInject`, `shouldInject`,
  `delivery`, `assetPath`, `mode`, `runtime`, `nonce`, `hydration`, for a page
  a framework takes over after it is parsed, and `softNavigationEvents`, for
  one whose router replaces content without a load. A site that renders the
  tag itself, one that serves the runtime as a cached asset, and one that ships
  a smaller build all need a different answer, and the wrong default costs
  every visitor bytes ([deployment.md](deployment.md#what-a-public-visitor-pays)).
- **What the response's CSP says** — `manageCsp`, `strictDynamic`,
  `frameAncestorsExtra`, `scriptSrcExtra`. The admin has to be allowed to frame
  the page and the injected script has to be allowed to run, without the package
  ever loosening a policy the site already sends. An entry of
  `allowedOrigins`, `frameAncestorsExtra` or `scriptSrcExtra` that holds `;`,
  `,` or a control character is refused at startup: in the header it would end
  the directive and start one of its own.
- **How an update reaches an element** — `fragmentEndpoint` / `fragments`,
  `routeStrategy`, `onUnfaithfulPatch` and its 1.x name `onUnboundChange`,
  `strategies`, `dependencies`, `autoBind`, `subfieldCoverage`. Three
  strategies exist because patching cannot create markup and a route refresh
  cannot be done per keystroke
  ([overview](architecture/overview.md#the-five-objects)); `autoBind` is how a
  page with no `data-payload-field` at all gets its bindings;
  `subfieldCoverage: 'declared'` makes an edit inside a partly bound group
  count as unbound unless the page binds or covers that path
  ([bindings](bindings.md#what-a-page-accounts-for),
  [ADR 0022](architecture/0022-subfield-coverage-is-declared.md)).
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

- `strict` refuses when the adapter is created (when its module loads; `LivePreviewScript` creates one each time it renders, so its first render throws), not on a public response: it requires
  `authorizePreview`, non-empty `allowedOrigins` (`https:` ones in
  production), and no `'referer'` in the resolved `previewSignals`. Astro's
  `livePreview()` integration does not apply it in `mode: 'inline'` or
  `'loader'`, which inject at build time and build no per-request policy;
  `'middleware'` refuses it unless `authorizePreviewModule` names the hook
  (below).
- `authorizePreview` runs on requests carrying preview intent. Only a context
  produced by `authorizePreviewRequest()` authorizes; anything else — a
  `{ authorized: true }` literal, an unfrozen copy, `null` — refuses, and a refusal
  leaves the response as rendered: no runtime, no CSP change, no nonce.
  [docs/authorization.md](authorization.md) has the strategies.
- `previewSignals` and `previewQueryParams` are intent, not authorization.
  `inject: 'always'` treats every request as intent, so the hook runs on each.
- `shouldInject` filters script injection only; it never suppresses CSP
  handling. `autoInject: false` keeps CSP management and lets you place the
  tag with `renderLivePreviewScript()` (Astro, Next.js, Nuxt).
- `delivery: 'asset'` replaces the inlined runtime with a bootstrap of a few
  hundred bytes that fetches it as `<assetPath>/runtime.<hash>.js` — but only
  once it finds itself in a preview context. The current Next.js fixture's
  delivery, held by `tests/e2e/specs/public-response.spec.ts`, is 1 344 bytes
  in its direct script element, including the arming for React's first commit
  (ADR 0015), against 164 737 for authorized inline delivery. It fetches one
  response the browser may
  keep for a year, because the file name is the hash of its contents. It needs
  the asset route mounted, which each adapter page shows; the caching, the
  integrity check and what a proxy must not do to the file are in
  [docs/deployment.md](deployment.md#the-runtime-as-a-cached-asset).
- `mode` (Astro): `'inline'` bakes the runtime into every page at build time;
  `'loader'` injects a small bootstrap that fetches the runtime as a hashed,
  SRI-verified asset only inside a preview. Neither decides anything per
  request. `authorizePreview` and `shouldInject` are functions that would have
  to run on one, so both modes refuse them at startup, as they refuse
  `authorizePreviewModule`, and the message names where they can run. The
  options that only describe a request (`strict`, `previewSignals`,
  `previewQueryParams`, `inject` and the CSP options) are accepted and have no
  effect there, so one options object can be shared. `'middleware'` registers
  the request-time middleware from serialized options, so it cannot carry
  `authorizePreview` or `shouldInject` as functions either. It takes the hook
  by module reference instead, `authorizePreviewModule`, and refuses the
  `strict` default without one; register `createLivePreviewMiddleware()`
  yourself for `shouldInject`. The loader asset's caching and CSP are in
  [docs/deployment.md](deployment.md#the-runtime-as-a-cached-asset).
- `authorizePreviewModule` (Astro `mode: 'middleware'`, the Nuxt module): a
  server module whose default export is the `authorizePreview` hook. A path
  beginning with `./` is relative to the project root; a package specifier is
  passed to the bundler unchanged, and so is an alias, except that the Nuxt
  module writes the file an alias names, with its extension, where it finds
  one; a reference beginning `../` is refused. The generated code throws when
  the server loads it if the export is not a function
  ([ADR 0024](architecture/0024-authorization-by-module-reference.md)).
- `manageCsp: 'full'` also manages a nonce'd `script-src`; `strictDynamic`
  adds `'strict-dynamic'`, after which CSP 3 ignores `'self'` and host
  sources, so every script on the page must carry the nonce. When the page's
  policy has no `script-src`, the merge starts from what the browser used
  instead (`default-src`) and adds the nonce to it, so the page's own script
  sources keep working. The Next.js
  middleware writes that `script-src` only into a response it injects the
  script into; on any other response, such as `NextResponse.next()`, it keeps
  `frame-ancestors` and warns once in development.
- `runtime` chooses which artifact the page carries. The default is the full
  one; `LEAN_RUNTIME` from `payload-live-preview/lean` is about 37 KiB gzip
  against 46 KiB for the default inline script — it leaves out the fragment and route strategies, the keyed
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
  prelude already carries the route strategy. Its GET or registered host
  refresh receives no live-preview fields, so the built-in strategy reports a
  successful render as `partial`. The runtime reapplies reachable bindings;
  server-derived or unbound output may still reflect saved data until Payload
  reports the save, which renders such a route once more
  ([ADR 0018](architecture/0018-route-refresh-fidelity.md)).
- `onUnfaithfulPatch` decides what happens when the runtime knows a patch cannot
  reach what the server would have drawn: a value no renderer can represent, a
  Lexical block whose markup the write has to drop, or a changed field the page
  has no binding for at all. `'escalate'`, the default, hands a patch that fell
  short to the fragment strategy when a boundary covers its element and to the
  route otherwise, and a changed field with no binding to the route alone. It
  does nothing without `fragments` or `routeStrategy` (an unbound field is
  answered by the route strategy, which either option brings) — and says so
  once, as LP0808, the first time it has
  something to hand over and nothing to hand it to; `inspect().fidelity.canEscalate`
  reports whether any strategy exists. `'warn'` reports a patch that fell short
  as LP0411 and keeps it, and a scalar field with no binding is named by LP0203
  under every mode; `'ignore'` keeps the patch silently. It skips the connection's
  first message, where every field counts as changed and the page has just been
  rendered from them ([docs/hybrid.md](hybrid.md#a-change-nothing-binds)).
  `inspect().fidelity` counts the findings under every mode — `unfaithful`,
  and `escalated` for the ones a strategy took — so a page that has nowhere to
  escalate to shows the gap rather than hiding it.
  `onUnboundChange` is the 1.x name for the same decision and still decides when
  it is given — `'route'` means `'escalate'` — until it is removed in 3.0. An
  adapter given it warns once in development, and `pll migrate` renames it.
- `hydration: 'react'` holds the runtime's start — no `ready`, no listener —
  until React has committed the tree that holds the bindings, so the first
  write lands on markup React keeps instead of on markup React is about to
  compare with its own render and regenerate
  ([ADR 0015](architecture/0015-first-write-after-hydration.md)). The Next.js
  adapter sets it on every script it emits. `hydration: 'vue'` holds it until
  Vue has mounted the app around the bindings — and, on Nuxt, until a Suspense
  still hydrating at the mount has resolved — so the write is not repaired
  back to the server's value by Vue's hydration; the Nuxt adapter sets it.
  `hydration: 'sveltekit'` holds it until SvelteKit's root has mounted, so
  Svelte's hydration does not set its own text back over the write; the
  SvelteKit handle sets it, and a page served with `csr = false` starts at
  once. A page built by hand with `generateInlineScript()` may set any of
  them. `hydration: 'manual'` holds it until the page calls `markHydrated()`
  from `payload-live-preview`, for a framework this package cannot observe. It
  is the one value an adapter takes, and it replaces the wait the adapter sets
  itself. The call may come before the runtime has loaded. Capped at five
  seconds, then `LP0607`.
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
  one flush when it closes. A write waits at most 100 ms for that frame: WebKit
  gave a visible preview frame none for seconds (2026-10-22), and the fallback
  timer writes instead. Typing therefore costs one frame at the start of a
  phrase and one at the end of it, not 50 ms per keystroke. `debounceMs: 0`
  removes the window entirely — and with it the merge coalescing that shares it.
- `intersectionRootMargin` may not pull a write in ahead of the fold inside a
  preview iframe. With an implicit root the browser measures the intersection
  against the top-level viewport and clips it to the frame's own box, and a
  preview is always framed. An observation recorded for this package (a footer
  far below a 600 px frame stayed deferred, LP0301, with a margin of `'3000px'`
  as with `'0px'`) is not held by any test here, so treat the option as unproven
  for a framed preview. What does work is the replay — the write lands as soon
  as the element is scrolled into view. `visibilityGateThreshold` does not share
  the doubt: it counts bindings rather than pixels and decides whether the gate
  runs at all, so a page that must stay live below the fold raises it or sets
  `disableVisibilityGate`.
- `dependencies` and `data-payload-depends` say the same thing from two sides;
  both matter only under `skipUnchanged`. `revealEditedField` is described in
  [docs/reveal.md](reveal.md), `scopeBindingsByOwner` in
  [docs/bindings.md](bindings.md).

## Payload config plugin

`livePreview()` from `payload-live-preview/plugin` is a separate configuration
surface. It transforms `payload.config.ts`; these options are not serialized
into the frontend runtime:

| Option         | Meaning                                                                                                               | Default     |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| `baseUrl`      | Frontend origin used by the installed `admin.livePreview.url` callback                                                | required    |
| `collections`  | Collection slug to a path string, `null`, or `({ data, locale }) => string \| null`; `null` means no preview          | `{}`        |
| `globals`      | Global slug to a path string, `null`, or `({ data, locale }) => string \| null`; `null` means no preview              | `{}`        |
| `fallback`     | Path for an unmapped entity or a resolver that returns `''`; `null` means no preview                                  | `'/'`       |
| `previewParam` | Query parameter appended as `<name>=true`; keep a custom name in the adapter's `previewQueryParams`; `null` adds none | `'preview'` |
| `breakpoints`  | Toolbar breakpoints with number or CSS-string dimensions; a supplied list replaces the root list                      | preserved   |
| `order`        | Position among plugins in Payload 3 and 4, which run lower values first; Payload 2 ignores it                         | unset (`0`) |

The mapped keys are added to the existing root collection/global lists with
stable order and no duplicates. Other root Live Preview fields are preserved.
The plugin refuses a competing root URL and a URL on a selected entity when
either is already present. A plugin that runs later in Payload's effective
execution order can still replace that URL; make this transform run after
URL-writing plugins with `order`, or compose their callbacks explicitly. It accepts no
signing secret, token or authorization hook. Full setup and conflict rules:
[payload.md](payload.md). The reason this cross-version surface stays structural
and authorization-free is [ADR 0017](architecture/0017-structural-payload-config-plugin.md).

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

The root import does not carry every export. These live only in a focused
entry: `livePreview()` in `/plugin`, `definePreview()` in `/server`,
`buildLivePreviewUrl()` in `/payload`, `LEAN_RUNTIME` in `/lean`, `createFragmentStrategy()` and
`createRouteStrategy()` in `/fragment`, `PluginManager` and
`createUnboundFieldsOverlayPlugin()` in `/plugins`, `registerLexicalNode()` and
`registerDefaultBlocks()` in `/lexical`, and the structural renderer and keyed
morph in `/structural`. Every entry is a self-contained bundle with its own type
declarations and its own copy of the code it shares with the others, so a
Lexical node or block renderer registered through one entry is not seen by
another ([docs/renderers.md](renderers.md#renderrichtext-one-renderer-for-ssr-and-preview));
the document given to `setSanitizerDocument()` is held once for all of them
since 2.0.2, and since 2.1 a call names its own (`sanitizeHtml(html, { document })`,
`lexicalToHtml(content, { document })`). The adapters (`react`, `vue` and `nuxt-module` included), `annotate`, `codegen/astro`, `doctor`, `migrate` and
the `.astro` components are ESM-only; the rest ship ESM and CommonJS builds.

Every entry has a stability class, stated here and, for the experimental
ones, as `@beta` on the declarations in the API reports (`etc/api/*.api.md`):

- **Stable** — semver. A removal or a default change waits for 3.0 and is
  recorded in the ADR 0007 ledger; a deprecated alias stays until then.
- **Experimental** — may change in a minor, with a changeset that names the
  change and how to move; the declarations carry `@beta`.
- **Tooling** — programmatic access to what the `pll` commands and the build
  integrations do. It follows the CLI: an option or a finding may change in a
  minor with a changeset, and the exit codes and the report shapes are the
  contract.

| Entry                                                | Class        | Contents                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload-live-preview`                               | Stable       | Client, inline script generator, renderers, built-in plugins, authorization and binding helpers; not the exports named above.                                                                             |
| `payload-live-preview/core`                          | Stable       | The client and runtime without the built-in plugin constructors, generator or adapters.                                                                                                                   |
| `payload-live-preview/client`                        | Stable       | `LivePreviewClient` and `initLivePreview()` alone.                                                                                                                                                        |
| `payload-live-preview/structural`                    | Experimental | The structural array renderer, the keyed morph and the `data-payload-depends` helpers; `morphElement()`, `MorphOptions`, `isMorphBoundary()` and `retainIslandBoundary()` are `@beta`, ADR 0008's engine. |
| `payload-live-preview/lexical`                       | Stable       | `lexicalToHtml()`, `lexicalToPlainText()`, `registerLexicalNode()`, `registerBlockRenderer()`, `setSanitizerDocument()`.                                                                                  |
| `payload-live-preview/plugins`                       | Stable       | `PluginManager`, plugin types and the built-in plugins.                                                                                                                                                   |
| `payload-live-preview/fragment`                      | Stable       | `createFragmentStrategy()` and `createRouteStrategy()`: the browser half of fragment boundaries.                                                                                                          |
| `payload-live-preview/server`                        | Stable       | `definePreview()`, `authorizePreviewRequest()`, `issuePreviewToken()`, `createPreviewBindings()`, `bind()`.                                                                                               |
| `payload-live-preview/plugin`                        | Stable       | `livePreview()` configures Payload 2.32.3 or 3.x structurally: one root URL callback, merged entity lists and optional root breakpoints; no authentication or Payload import.                             |
| `payload-live-preview/payload`                       | Stable       | The lower-level `buildLivePreviewUrl()` callback for manual or nullable `payload.config.ts` routing; imports nothing from `payload`.                                                                      |
| `payload-live-preview/{astro,nextjs,sveltekit,nuxt}` | Stable       | One framework adapter each.                                                                                                                                                                               |
| `payload-live-preview/nuxt-module`                   | Stable       | The Nuxt module: registers the Nitro plugin from `nuxt.config.ts`; data options, `authorizePreview` by module reference (`authorizePreviewModule`), no `shouldInject`.                                    |
| `payload-live-preview/react`                         | Stable       | `useLivePreviewDocument()`: the merged document as a hook, and `LivePreviewRouteRefresh`, which lends the runtime the router's refresh (needs `react`).                                                   |
| `payload-live-preview/vue`                           | Stable       | The same as a composable (needs `vue`).                                                                                                                                                                   |
| `payload-live-preview/lean`                          | Experimental | `LEAN_RUNTIME`: the smaller runtime artifact, as a value for the `runtime` option. Passing it is stable; the artifact's fields (`RuntimeArtifact`) may gain one in a minor.                               |
| `payload-live-preview/annotate`                      | Experimental | `livePreviewAnnotate()`: the build-time annotator as a Vite plugin (`@beta`). No `ts-morph`.                                                                                                              |
| `payload-live-preview/astro/RichText.astro`          | Stable       | The `RichText` component.                                                                                                                                                                                 |
| `payload-live-preview/astro/PreviewBoundary.astro`   | Stable       | The `PreviewBoundary` component.                                                                                                                                                                          |
| `payload-live-preview/codegen`                       | Tooling      | Type generation from a Payload config (needs `ts-morph`).                                                                                                                                                 |
| `payload-live-preview/codegen/astro`                 | Tooling      | `livePreviewCodegen()`: the Astro integration that runs that generation on start and in `astro dev`.                                                                                                      |
| `payload-live-preview/doctor`                        | Tooling      | `runDoctor()` and `analyzeProbe()`: the `pll doctor` checks as a library.                                                                                                                                 |
| `payload-live-preview/migrate`                       | Tooling      | `migrateSource()` and the codemods behind `pll migrate` (needs `ts-morph`).                                                                                                                               |

`payload-live-preview/astro/middleware-entry` also exists; Astro's
`mode: 'middleware'` registers it and nothing else imports it.

## `serverURL` and `mergeDepth`

Payload 3.x posts raw form values on every edit, so relationship and upload
fields arrive as bare ids. With `serverURL` set, the runtime re-fetches the
update through the Payload REST API (`POST` with
`X-Payload-HTTP-Method-Override: GET`, `credentials: 'include'` — the same
request the official client makes) and renders the populated document; on
failure it renders the raw values.

The merge request has no deadline unless you set one. A fragment render gives up
after 5 seconds and a route refresh after 8, but without a deadline a merge that
never answers leaves its update unshown: after ten minutes the DOM runtime still
shows what it showed before, with `inspect().revisions.display` at `pending`, and
a hook still has `isLoading: true` and `status: 'idle'` with no `error`
(`tests/unit/core/merge-without-deadline.test.ts`). A slow or stalled Payload
API then shows up as an update that never arrives, not as a failure.
`mergeTimeoutMs` sets a deadline for the DOM runtime and a hook's `timeoutMs` for
a hook: when it passes, the merge is aborted and an answer that comes later is not
read. The runtime then renders the raw values and reports the shortfall, as it
does for a merge the server refused; a hook reports `unavailable` and keeps the
last good document (`tests/unit/core/merge-timeout.test.ts`). Both are off by
default in 2.x.

Payload 2 uses the accepted `fieldSchemaJSON` instead of a v3 merge
target. It retains the schema for later updates that omit it, settles scalar
values locally and populates raw relationship/upload IDs with bounded
credentialed collection GETs. The GETs preserve locale and depth and never
send the method-override POST ([ADR 0010](architecture/0010-protocol-capabilities-by-observation.md)).

The DOM runtime asks only when the answer can change what the page shows. A page whose every
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
binds both once: where the browser reaches Payload at the same origin as your
server code, spread its `runtimeOptions` (`serverURL`, `apiRoute`, `mergeDepth`)
into the adapter; otherwise pass the browser's origin as `serverURL` and take
`apiRoute` and `mergeDepth` from it. `serverURL` is also the server a media
document's relative `url` resolves against ([Media URLs](renderers.md#media-urls)).
The preview page must reach the Payload API
with the editor's credentials — same-site cookies, or CORS with credentials
([docs/authorization.md](authorization.md)).
