# Migration guide

> **2.0 is released.** The v2 readiness table is now the default (strict
> authorization, query-only intent, referrer trust off, parent/opener message
> source, skip-unchanged, strict sanitizer), `serverURL` requires an explicit
> `mergeDepth`, and the deprecated 1.x names below were removed. Pass
> `defaults: 'v1'` to stage the migration one row at a time; run `pll migrate`
> for the renames and `pll doctor --v2` to audit a page.

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

## To 2.0: `defaults: 'v2'`, one row at a time

2.0 flips a table of defaults toward security and performance. You can adopt
every flip today, incrementally, by opting in — `defaults: 'v2'` sets the
whole table, or set any single option to move one row. `pll doctor --v2`
audits a served page against the table; `pll migrate` rewrites the renamed
APIs. Nothing here breaks in 1.x; the flip is the 2.0 release.

Run the tooling first:

```bash
npx pll migrate ./src            # dry-run: shows the renames it would make
npx pll migrate ./src --write    # apply them
npx pll migrate ./src --only rename-is-preview-request   # one codemod
npx pll doctor https://your-site/page --admin https://cms --v2
```

`pll migrate` needs `ts-morph` — an optional peer, so run `npm i -D ts-morph`
if you do not already have it. It
rewrites only names a file binds from `payload-live-preview`, so an
`isPreviewRequest` of your own is left alone. Anything it cannot rewrite
safely — an object shorthand, a re-export, a call whose options are not a
literal — is listed as `file:line` and that file is left untouched. Exit codes:
`0` nothing needs a human, `1` usage error or missing `ts-morph`, `3` at least
one file needs manual attention. `.astro`, `.vue` and `.svelte` files are
rewritten in their script blocks only.

`pll doctor` exits `0` with no error-level findings, `1` if the URL could not be
fetched, and `2` on any error-level finding. It reports redirects rather than
following them, so probe the final URL.

Then adopt the rows. Each is a readiness-table entry (ADR 0007):

| Row                | 1.x default                        | 2.0 (`'v2'`)                          | Adopt by                                     | Watch for                                                                     |
| ------------------ | ---------------------------------- | ------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Authorization      | response changes on intent alone   | `authorizePreview` required           | passing `authorizePreview` / `authorization` | a page that showed preview to anyone now needs a real editor session or token |
| Intent signals     | `['query','fetch-dest','referer']` | `['query']`                           | `previewSignals: ['query']`                  | a flow that relied on the admin referer alone must add `?preview=true`        |
| Referrer trust     | on                                 | off outside local dev                 | `disableReferrerDetection: true`             | same as above                                                                 |
| Message source     | any origin-valid window            | parent/opener only                    | `eventSourcePolicy: 'parent-or-opener'`      | a custom embedding that posts from another window                             |
| Unchanged bindings | re-applied                         | skipped                               | `skipUnchanged: true`                        | a renderer with side effects that expected every message                      |
| Sanitizer          | `id` and every `data-*` pass       | `id`/`name`/`data-payload-*` stripped | `sanitizerPolicy: 'strict'`                  | rich text that relies on `id` or `data-*` (list the CSP `trusted-types` name) |
| `allowedOrigins`   | optional                           | required, non-empty, `https:`         | set it explicitly                            | a dev-only origin left implicit                                               |

### Renamed and moved (what `pll migrate` handles)

- `isPreviewRequest()` → `hasPreviewIntent()` — same signature.
- `createPreviewBindings({ authorized })` → `{ authorization }` — pass the
  context from `authorizePreviewRequest()`.
- `fetchPreviewDocument()` / `fetchPreviewGlobal()` (root) →
  `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()`
  from `payload-live-preview/server`.

### Before / after

```ts
// 1.x
import { isPreviewRequest, fetchPreviewDocument } from 'payload-live-preview';
if (isPreviewRequest(request)) {
  /* … */
}
const doc = await fetchPreviewDocument({ serverURL, slug });

// 2.0 (after `pll migrate --write`, plus definePreview wiring)
import { hasPreviewIntent } from 'payload-live-preview';
import { definePreview } from 'payload-live-preview/server';
if (hasPreviewIntent(request)) {
  /* … */
}
const preview = definePreview({ serverURL, depth: 2 });
const doc = await preview.fetchDocument({ slug, authorization });
```

The runtime keeps warning, once per process outside production, for every
renamed or moved API until 2.0 removes it.

### Changes nothing warns about

The rows above announce themselves: a refused preview, a missing binding, a
`pll doctor` finding. These do not. Each one changes output that used to be
correct, so nothing errors and nothing logs — walk this list once against your
own site.

**Rich text markup is classes now, not data attributes.** The strict sanitizer
strips `data-*`, so the Lexical renderer emits classes instead:

| Was                                    | Is                                                      |
| -------------------------------------- | ------------------------------------------------------- |
| `data-block-type="hero"`               | `class="lp-block lp-block--hero"`                       |
| inline block attributes                | `class="lp-inline-block lp-inline-block--<slug>"`       |
| relationship attributes                | `class="lp-relation lp-relation--<slug>"`               |
| the built-in blocks                    | `lp-block-callout`, `-image`, `-video`, `-code`, `-cta` |
| inline `style` for alignment or indent | `class="lp-align-<align> lp-indent-<n>"`                |

Block fields are no longer serialised into attributes at all. **Any CSS or
query selector aimed at the old attributes stops matching, silently.** Grep your
styles and your tests for `data-block-type`, `data-payload-` and any attribute
selector on rich-text output before you upgrade. `docs/renderers.md` lists the
full class vocabulary.

**An empty value now clears its binding.** Every renderer follows one contract:
an empty value, or a URL the sanitizer refuses, clears the element and counts as
a write, where 1.x left the previous link, text or image in place. A field the
editor empties now empties on the page. `<img>` writes rebuild or remove
`srcset` and `sizes` with the `src`.

**`email` is its own renderer.** It was an alias of `url`, which turned
`someone@example.com` into a relative link. It writes a `mailto:` URL now. If
you bound an address with `data-payload-type="url"` to work around that, drop
the override.

**Date inputs get local time.** `date` and `datetime-local` inputs receive the
value in the visitor's time zone, because that is what those inputs mean. Other
elements still get the ISO instant. A test asserting a UTC string in an input
needs updating; a page that displayed the raw value now shows local time.

**`generateInlineScript({ serverURL })` requires `mergeDepth`.** The client and
the adapters already did; the inline generator was the last one guessing. Pass
the same depth your Payload queries use, or populated relationships degrade to
IDs after the first edit.

**Two removals.** The `NextMiddleware` type is gone — use
`PreviewAdapterOptions` from `payload-live-preview/nextjs`. The `checkFetchDest`
option is gone with it; `previewSignals` decides which signals count, and
`'fetch-dest'` is one of them.

If you consume `payload-live-preview/migrate` as a library, `Codemod` no longer
carries `apply`, so importing its types no longer drags in `ts-morph`.
