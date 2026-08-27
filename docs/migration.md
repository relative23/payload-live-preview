# Migration guide

## From `0.1.0` of this package

`1.0.0` is a clean break — there is no API shim. The migration is small in code but large in semantics:

| `0.1.0`                                                       | `1.0.0`                                                                                                                                       |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `initLivePreview(config)` returns `LivePreviewClient \| null` | Same signature, but `config.allowedOrigins` is **required** when neither `document.referrer` nor a localhost origin can vouch for the parent. |
| `livePreviewEvents` (module singleton)                        | Each `LivePreviewClient` owns an `EventEmitter`; access via `client.events`.                                                                  |
| `client.use(plugin)`                                          | Same API. Plugins now receive a per-instance `PluginContext` instead of touching shared state.                                                |
| `getFrameAncestors()`                                         | Replaced by `buildFrameAncestors({ self, origins })` — typed, deduplicates, supports `'none'`.                                                |
| `safeSetTextContent(el, str)`                                 | Removed. Use `el.textContent = str` directly (the original was a no-op wrapper).                                                              |
| `data-payload-array-template`                                 | Unchanged. Add `data-payload-structural` to opt into synchronous, diff-based updates that retain unaffected keyed nodes.                      |

### Breaking semantics

- `isSafeUrl('')` now returns `false` (was `true`). This affects edge cases where an empty string was being mistakenly treated as a safe URL.
- The hard-coded `'de'` locale fallback for dates/numbers is gone; the runtime now reads `navigator.language` or `<html lang="…">`, falling back to `'en'`.
- The previous inline runtime broadcast to a hard-coded localhost port list. `1.0.0` allows any localhost port in dev via a regex; the broadcast list is wider.

## From `@payloadcms/live-preview`

The official React-focused library and this package coexist; they have different focuses:

| Use this                         | When                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@payloadcms/live-preview-react` | You're rendering inside React and can `useLivePreview` directly.                                               |
| `payload-live-preview`           | You're rendering with Astro, SvelteKit, Nuxt, plain HTML — or want DOM-binding semantics that survive SSR/SSG. |

Migration steps when moving from the official library:

1. Stop calling `useLivePreview()` in React components.
2. Annotate the **rendered** DOM with `data-payload-field="…"` attributes.
3. Mount our library once (`generateInlineScript` or the relevant adapter).
4. Updates flow into the DOM directly — no React re-renders needed for previews.

This makes previews work in SSR/SSG regions without a client-side component owner
(Astro static pages, plain server-rendered Svelte, or ordinary HTML). Keep bindings
outside hydrated React/Vue/Svelte islands: a later component render can overwrite
direct DOM patches. Inside such islands, use the official framework hook so the
owning component tree performs the update.

## From `1.0.x` to `1.1.0`

Nothing breaks. Three things are new, and one name changes:

- `isPreviewRequest()` → `hasPreviewIntent()`. Same signature, honest name.
  The old name stays for the rest of 1.x and warns once per process outside
  production. It is removed in 2.0 ([ADR 0007](architecture/0007-v2-defaults-and-renames-ledger.md), entry 1).
- Every adapter accepts `authorizePreview`. Without it the adapter behaves
  as before and says so once outside production; with it a refusal blocks
  injection, CSP and the nonce. `strict: true` requires it, plus explicit
  `https` admin origins and no referrer trust.
- `defaults: 'v2'` applies every 2.0 default that exists as an option
  (`strict`, query-only `previewSignals`, `skipUnchanged`,
  `disableReferrerDetection`, `eventSourcePolicy: 'parent-or-opener'`).
  Set it now to run today what 2.0 will run by default; override any row
  explicitly where you need the old behaviour.
- `createPreviewBindings({ authorized: boolean })` still works; prefer
  `{ authorization: context }` with the context from `authorizePreviewRequest()`.
  Under `strict` the boolean is refused.

## From `1.1.0` to `1.2.0`

Nothing breaks. The initial draft read has a home:

- `payload-live-preview/server` is the server-only surface: `definePreview({ serverURL, depth })`
  with `fetchDocument()` / `fetchGlobal()` (explicit `authorization`, typed failure,
  `signal`, timeout), plus `authorizePreviewRequest`, `issuePreviewToken`,
  `hasPreviewIntent` and the binding helpers. Spread `runtimeOptions` into the
  adapter so fetch and merge share one depth.
- `fetchPreviewDocument()` / `fetchPreviewGlobal()` on the root entry are deprecated
  and warn once outside production; they are removed in 2.0
  ([ADR 0007](architecture/0007-v2-defaults-and-renames-ledger.md), entries 9–10).

## From `1.8.x` to `1.9.0`

Nothing breaks. What changed underneath:

- Four focused entries — `payload-live-preview/client`, `/structural`,
  `/lexical`, `/plugins` — sit beside `/core` and `/server`. The root barrel
  is unchanged and now tree-shakes: one symbol imported from it ships that
  symbol, not the bundle (`npm run test:treeshake` holds the numbers; table
  in [docs/benchmarks.md](benchmarks.md)). Nothing to migrate; importing
  from a focused entry is optional.
- Minification moved from esbuild to terser. The public callable names
  still carry their `fn.name`; internal names are mangled as before.
- The keyed morph no longer moves a retained element around whitespace-only
  text nodes, so a focused `<input>` survives an update in markup that keeps
  its indentation (Astro 4–6, most SSR). If you had worked around lost
  focus by setting `data-payload-strategy="replace"` on such lists, you can
  remove it.
- The README compatibility table is generated from `quality/compat-matrix.json`;
  every version in it is one CI installs (ADR 0009).
