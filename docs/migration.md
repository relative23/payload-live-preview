# Migration guide

## Upgrading to 2.0

2.0 flips a table of defaults toward security and performance, renames a few
APIs, and removes the 1.x names. Two tools carry the mechanical part:
`pll migrate` rewrites the renames in your source, and `pll doctor --v2`
audits a served page against the defaults table. `defaults: 'v1'` restores the
1.x table on any adapter, `generateInlineScript()` or `LivePreviewClient`, so a
site can move one row at a time; an explicit option always wins over the
profile.

### Run the tooling first

```bash
npx pll migrate ./src            # dry run: shows the renames it would make
npx pll migrate ./src --write    # apply them
npx pll migrate ./src --only rename-is-preview-request   # one codemod
npx pll doctor https://www.example.com/page --admin https://cms.example.com --v2
```

`pll migrate` needs `ts-morph` — an optional peer, so run `npm i -D ts-morph`
if you do not already have it. It rewrites only names a file binds from
`payload-live-preview`, so an `isPreviewRequest` of your own is left alone.
Anything it cannot rewrite safely — an object shorthand, a re-export, a call
whose options are not a literal — is listed as `file:line` and that file is
left untouched. Exit codes: `0` nothing needs a human, `1` usage error or
missing `ts-morph`, `3` at least one file needs manual attention. `.astro`,
`.vue` and `.svelte` files are rewritten in their script blocks only. The
codemods are `rename-is-preview-request`, `rename-admin-origins-option`,
`rename-bindings-authorized-option` and `move-fetch-preview-helpers`.

`pll doctor --v2` reads the served inline configuration and reports each
runtime row still at its `'v1'` value as `LP0709`. It exits `0` with no
error-level findings, `1` if the URL could not be fetched, and `2` on any
error-level finding; it reports redirects rather than following them, so probe
the final URL. The full audit is in
[troubleshooting.md](troubleshooting.md#auditing-a-deployment-pll-doctor).

### The defaults table

Each row is an entry of the readiness table in
[ADR 0007 — 2.0 defaults, migration policy, and the renames ledger](architecture/0007-v2-defaults-and-renames-ledger.md).
`defaults: 'v1'` sets the whole left column; a single option moves one row.

| Row                | `defaults: 'v1'`                   | 2.0 default                           | Option                                  | Watch for                                                                     |
| ------------------ | ---------------------------------- | ------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| Authorization      | response changes on intent alone   | `authorizePreview` required           | `strict`                                | a page that showed preview to anyone now needs a real editor session or token |
| Intent signals     | `['query','fetch-dest','referer']` | `['query']`                           | `previewSignals`                        | a flow that relied on the admin referer alone must add `?preview=true`        |
| Referrer trust     | on                                 | off outside local dev                 | `disableReferrerDetection: true`        | same as above                                                                 |
| Message source     | any origin-valid window            | parent/opener only                    | `eventSourcePolicy: 'parent-or-opener'` | a custom embedding that posts from another window                             |
| Unchanged bindings | re-applied                         | skipped                               | `skipUnchanged: true`                   | a renderer with side effects that expected every message                      |
| Sanitizer          | `id` and every `data-*` pass       | `id`/`name`/`data-payload-*` stripped | `sanitizerPolicy: 'strict'`             | rich text that relies on `id` or `data-*` (list the CSP `trusted-types` name) |
| `allowedOrigins`   | optional                           | required, non-empty, `https:`         | set it explicitly                       | a dev-only origin left implicit                                               |
| `mergeDepth`       | `1`                                | required with `serverURL`             | `mergeDepth: <depth of your query>`     | populated relationships degrade to IDs when the depths differ                 |

### Renamed, moved and removed

`pll migrate` handles the first four:

- `isPreviewRequest()` → `hasPreviewIntent()` — same signature; the old name
  is gone.
- `hasPreviewIntent(request, { adminOrigins })` → `{ allowedOrigins }` — the
  name everything else uses; `adminOrigins` is a deprecated alias that is
  removed in 3.0.
- `createPreviewBindings({ authorized })` → `{ authorization }` — pass the
  context from `authorizePreviewRequest()`; the boolean is no longer accepted.
- `fetchPreviewDocument()` / `fetchPreviewGlobal()` (root) →
  `definePreview({ serverURL, depth }).fetchDocument()` / `.fetchGlobal()`
  from `payload-live-preview/server`; the root helpers are gone.

Not a codemod target, because TypeScript reports each of them:

- `CachedElement.boundary` is `hidesWhenEmpty` — the `data-payload-boundary`
  anchor that hides itself while its field is empty. Only a custom renderer
  that read the flag is affected.
- The `NextMiddleware` type is gone — use `PreviewAdapterOptions` from
  `payload-live-preview/nextjs`. The `checkFetchDest` option is gone with it;
  `previewSignals` decides which signals count, and `'fetch-dest'` is one of
  them.
- `generateInlineScript()` no longer accepts `nonce`; pass it to
  `wrapWithScriptTag()`.
- If you consume `payload-live-preview/migrate` as a library, `Codemod` no
  longer carries `apply`, so importing its types no longer drags in `ts-morph`.

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

### Changes nothing warns about

The rows above announce themselves: a refused preview, a missing binding, a
`pll doctor` finding. These do not. Each one changes output that used to be
correct, so nothing errors and nothing logs — walk this list once against your
own site.

**Rich text markup is classes, not data attributes.** The strict sanitizer
strips `data-*`, so the Lexical renderer emits classes instead:

| Was                                    | Is                                                      |
| -------------------------------------- | ------------------------------------------------------- |
| `data-block-type="hero"`               | `class="lp-block lp-block--hero"`                       |
| inline block attributes                | `class="lp-inline-block lp-inline-block--<slug>"`       |
| relationship attributes                | `class="lp-relation lp-relation--<slug>"`               |
| the built-in blocks                    | `lp-block-callout`, `-image`, `-video`, `-code`, `-cta` |
| inline `style` for alignment or indent | `class="lp-align-<align> lp-indent-<n>"`                |

Block fields are no longer serialized into attributes at all. **Any CSS or
query selector aimed at the old attributes stops matching, silently.** Grep your
styles and your tests for `data-block-type`, `data-payload-` and any attribute
selector on rich-text output before you upgrade. [renderers.md](renderers.md)
lists the full class vocabulary.

**An empty value clears its binding.** Every renderer follows one contract:
an empty value, or a URL the sanitizer refuses, clears the element and counts as
a write, where 1.x left the previous link, text or image in place. A field the
editor empties now empties on the page. `<img>` writes rebuild or remove
`srcset` and `sizes` with the `src`.

**`email` is its own renderer.** It was an alias of `url`, which turned
`someone@example.com` into a relative link. It writes a `mailto:` URL. If you
bound an address with `data-payload-type="url"` to work around that, drop the
override.

**Date inputs get local time.** `date` and `datetime-local` inputs receive the
value in the visitor's time zone, because that is what those inputs mean. Other
elements still get the ISO instant. A test asserting a UTC string in an input
needs updating; a page that displayed the raw value now shows local time.

**`generateInlineScript({ serverURL })` requires `mergeDepth`.** The client and
the adapters already did; the inline generator was the last one guessing. Pass
the same depth your Payload queries use, or populated relationships degrade to
IDs after the first edit.

## Older versions

Every 1.x minor release was additive; the CHANGELOG lists them. `1.0.0` was a
clean break from `0.1.0`, without an API shim:

- `initLivePreview(config)` keeps its signature, but `allowedOrigins` is
  required whenever neither `document.referrer` nor a localhost origin can
  vouch for the parent.
- The module-level `livePreviewEvents` singleton became `client.events`; each
  `LivePreviewClient` owns its emitter, and plugins receive a per-instance
  `PluginContext`.
- `getFrameAncestors()` became `buildFrameAncestors({ self, origins })`;
  `safeSetTextContent()` was removed (`el.textContent = value` does the same).
- `isSafeUrl('')` returns `false`; the hard-coded `'de'` locale fallback gave
  way to `navigator.language`, then `<html lang>`, then `'en'`.

## From `@payloadcms/live-preview`

What this package shares with the official packages, what it does not, and
how to run both on one page is covered in [interop.md](interop.md).
