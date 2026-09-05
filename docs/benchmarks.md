# Benchmarks

Hot-path timings from `npm run test:bench -- --run` (Vitest bench, jsdom,
Node 24.18, 2026-08). jsdom is not a browser — read these as **relative
regression signals**, not absolute browser timings. Refresh this table when
touching the cache, scheduler, message bus, sanitizer, or Lexical renderer.

| Hot path                                          |   ops/sec |     mean |
| ------------------------------------------------- | --------: | -------: |
| `resolveFieldValue` — 4-level nested path         | 7,467,094 |  0.13 µs |
| `diffArray` — 100 items (insert + remove + moves) |   254,369 |   3.9 µs |
| `escapeHtml` — ~2 KB string                       |   132,718 |   7.5 µs |
| No-listener `elementUpdate` path — 300 bindings   |   768,610 |   1.3 µs |
| `lexicalToHtml` — 30 paragraphs with links        |     1,556 | 0.643 ms |
| `sanitizeHtml` — ~2 KB mixed document             |     1,169 | 0.856 ms |
| Ordered async token pipeline — 1,000 messages     |       518 | 1.931 ms |
| `ElementCache.buildFromRoot` — 300 bound elements |       216 | 4.633 ms |

Interpretation for a live-editing session: a keystroke triggers field
resolution (~µs), possibly a Lexical render + sanitize (~1.5 ms for a
sizeable rich-text field), and a scheduler flush. The dominant cost —
cache building — happens once at startup and after DOM mutations, not
per keystroke; 300 bindings build in ~4.6 ms. Dotted-path lookup validates every
segment as an own, pollution-safe property and still completes in about 0.13 µs.
Each measured representative operation on the per-keystroke path stays comfortably
below a 60 fps frame budget (16.7 ms), even in jsdom, which is substantially slower
than real browser DOM implementations. These isolated measurements do not promise a
whole-update bound for pages that render many expensive bindings in one revision.

## Update-to-paint in a real browser

`npm run test:browser-bench` (Playwright, Chromium, `playwright.bench.config.ts`)
measures the whole chain on the 300 / 1,000 / 5,000-binding scenario pages:
from the host's `postMessage` to the first animation frame after the bound
element changed, one changed field per message. The frame's MutationObserver
supplies the mutation time and the following `requestAnimationFrame` the paint
proxy — the earliest instant the new text can be on screen, not the
compositor's own timestamp. 200 samples per scenario after 20 warm-up
messages; the fixture's debounce is 25 ms and is included.

Measured 2026-08-27 on the maintainer host, `skipUnchanged` off (the fixture's
default):

| Bindings |     p50 |     p95 |     max | mutation p95 | budget (p95) |
| -------: | ------: | ------: | ------: | -----------: | -----------: |
|      300 | 18.6 ms | 39.6 ms | 41.2 ms |      22.8 ms |       100 ms |
|    1,000 | 30.3 ms | 44.9 ms | 87.6 ms |      28.1 ms |       100 ms |
|    5,000 | 43.0 ms | 64.3 ms | 83.9 ms |      40.6 ms |       100 ms |

The p50 grows with the page because every binding is resolved and rendered on
every message even though one changed — that is the cost `skipUnchanged`
removes. The scheduled deep-quality job runs this nightly as a **trend** and
keeps ninety days of reports; it asserts only that every sample produced a
measurement, because timing on a shared runner is not a fact a pull request
should fail on.

## `skipUnchanged` — what a keystroke costs with and without it

`tests/benchmarks/skip-unchanged.bench.ts` (Vitest bench, jsdom): one message
carrying 300 fields of which one changed, on a page with 300 bindings, awaiting
the flush's `afterUpdate`. jsdom's `requestAnimationFrame` is a ~16 ms timer,
so every figure includes that floor; the difference between the columns is the
work.

| Population             | off, mean | on, mean | work removed |
| ---------------------- | --------: | -------: | -----------: |
| 300 text bindings      |   22.7 ms |  17.8 ms |         ~4 × |
| 300 rich-text bindings |   98.5 ms |  18.9 ms |        ~30 × |

Two findings from getting these numbers right. The first version of this
bench awaited a `setTimeout(0)` and reported ~1.6 ms in both modes: the
scheduler flushes on `requestAnimationFrame`, so it was timing message dispatch
alone. And the first identity sorted object keys, which allocates a fresh
object per node: 0.685 ms for 300 small Lexical documents against 0.110 ms to
render them — the comparison cost six times the work it was avoiding. Plain
`JSON.stringify` is 0.153 ms for the same 300, and a reordered object simply
counts as changed, which is the safe direction.

## Structural updates: keyed morph versus replace

`tests/benchmarks/hot-paths.bench.ts`, "structural apply — morph versus
replace". Pre-seeded 100-item `<ul>` containers; the sample is one update.
What the morph keeps and what it never crosses is
[ADR 0008 — Keyed morph](architecture/0008-keyed-morph-ownership.md).

| Case                     | replace  | morph    | Δ             |
| ------------------------ | -------- | -------- | ------------- |
| one of 100 items changed | 0.425 ms | 0.455 ms | +7 % (~30 µs) |
| 100 items reordered      | 0.357 ms | 0.361 ms | within noise  |

The morph keeps the live element and edits it; the difference on a changed
item is the attribute diff and child walk that retention costs. Measured
2026-08-27 in jsdom; a trend, not a gate.

## Tree shaking — what one import costs

Measured 2026-08-27 with `npm run test:treeshake` (`scripts/check-tree-shaking.ts`):
a one-line consumer imports one symbol, Vite bundles it against the built
package resolved through `node_modules` (so `exports` and `sideEffects`
apply as after `npm install`), minified, gzip level 9.

| Consumer imports                                      | raw     | gzip     | budget |
| ----------------------------------------------------- | ------- | -------- | ------ |
| `escapeHtml` from `payload-live-preview`              | 287 B   | 220 B    | 250    |
| `lexicalToHtml` from `payload-live-preview`           | 13.6 KB | 4,273 B  | 4,350  |
| `initLivePreview` from `payload-live-preview`         | 113 KB  | 30,461 B | 31,000 |
| `generateInlineScript` from `payload-live-preview`    | 79.6 KB | 24,810 B | 25,200 |
| `initLivePreview` from `payload-live-preview/core`    | 113 KB  | 30,472 B | 31,000 |
| `lexicalToHtml` from `payload-live-preview/lexical`   | 13.8 KB | 4,383 B  | 4,450  |
| `morphElement` from `payload-live-preview/structural` | 2.9 KB  | 1,108 B  | 1,150  |
| `PluginManager` from `payload-live-preview/plugins`   | 13.0 KB | 3,621 B  | 3,700  |

Before this measurement existed, every row was 64 KB gzip: the root barrel
did not tree-shake at all. Three causes, all fixed in the same change:

1. esbuild's `keepNames` — implemented with top-level helper statements a
   consumer's bundler cannot prove pure. Name preservation now happens in
   the terser pass with the public allow-list (`scripts/build-dist.ts`), so
   `fn.name` on exported classes and functions is unchanged.
2. Minification in esbuild strips `/* @__PURE__ */` annotations (114 in the
   root bundle) that Rollup needs to drop unused constructions. esbuild now
   only bundles; terser minifies with `preserve_annotations`.
3. Import-time side effects in the library: the built-in renderer table
   (object spreads at module scope), Lexical node registration by
   `register()` calls at import, and an eager `new TextEncoder()`. Each is
   now a pure table or created on first use.

Rollup's `experimentalLogSideEffects` reports no remaining top-level side
effect in the source graph; the gate keeps it that way.
