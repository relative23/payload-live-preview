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
messages; the fixture's debounce is 25 ms.

Whether a sample pays that 25 ms depends on when it arrives. Since 2026-09-07
the first write of a quiet phase skips the window and the rest of the burst
waits for it. Since 2026-09-10 the spec waits out the window between samples,
so every measured message is the first of a quiet phase — a keystroke after a
pause, which is what an editor actually does. It asserts that cadence rather
than assuming it: the smallest gap between two messages must exceed the
fixture's debounce, read from the fixture's own config.

Before that pause the spec sent the next message the instant the previous one
had painted, so the gap was the driver's own round trip — 5 to 30 ms against a
25 ms window. Every sample but the first was therefore a burst message, and on
which side of the window it fell depended on how loaded the machine was. That
is why the 2026-08-27 and 2026-09-07 tables below disagree with each other and
with the one after them: they measured the driver as much as the runtime.

Measured 2026-08-27 on the maintainer host. The fixture sets no
`skipUnchanged`, so it runs under the runtime's default, `true`:

| Bindings |     p50 |     p95 |     max | mutation p95 | budget (p95) |
| -------: | ------: | ------: | ------: | -----------: | -----------: |
|      300 | 18.6 ms | 39.6 ms | 41.2 ms |      22.8 ms |       100 ms |
|    1,000 | 30.3 ms | 44.9 ms | 87.6 ms |      28.1 ms |       100 ms |
|    5,000 | 43.0 ms | 64.3 ms | 83.9 ms |      40.6 ms |       100 ms |

Re-measured 2026-09-07, four runs, on the same host: 27.1–27.4 ms p50 and
34.3–34.7 ms p95 at 300 bindings, 28.8–29.8 / 52.3–52.7 at 1,000, and
42.8–44.1 / 49.0–52.8 at 5,000. One further run, on a cold machine whose driver
round trip ran longer than the 25 ms window, measured 15.3 / 22.5 at 300
bindings — that is the same page with the leading write actually exercised, and
the reason the paragraph above says what the cadence decides.

Re-measured 2026-09-10 on a faster host, with the pause, three runs. The
"before" column is the same host and the same three runs without it, and it is
the spread rather than the median that the pause fixes:

| Bindings | before (3 runs, p50/p95)          | after (3 runs, p50/p95)           |
| -------: | --------------------------------- | --------------------------------- |
|      300 | 13.8/31.0 · 21.2/38.8 · 20.8/38.0 | 9.2/19.2 · 10.0/19.5 · 9.8/19.4   |
|    1,000 | 23.5/36.7 · 24.1/35.5 · 23.5/36.5 | 6.5/12.3 · 5.6/11.6 · 6.4/11.8    |
|    5,000 | 16.4/31.0 · 16.4/30.3 · 16.3/30.2 | 16.0/20.1 · 15.7/19.9 · 16.2/20.3 |

The 5,000-binding row barely moves because its driver round trip was already
longer than the window — those samples were quiet-phase messages by accident,
which is also why that page used to measure _faster_ than the 1,000-binding one.

One caveat on the absolute figures, which the pause did not introduce and does
not fix: the post time is read in the host document and the paint time in the
preview frame, and the two do not share a time origin. The frame's is later by
however long its navigation took — 6.4 ms on this host, and different per
scenario page — so every number here is low by that much. It was inside the
noise while the samples were bursts; at these latencies it is not, and a
mutation p95 can come out negative.

The p50 grows with the page because every binding is resolved on every message
even though one changed. `skipUnchanged`, on in the fixture, skips rendering
the unchanged ones, not that resolution and comparison. The scheduled deep-quality job runs this nightly as a **trend** and
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

Measured 2026-09-14 with `npm run test:treeshake` (`scripts/check-tree-shaking.ts`):
a one-line consumer imports one symbol, Vite bundles it against the built
package resolved through `node_modules` (so `exports` and `sideEffects`
apply as after `npm install`), minified, gzip level 9. The budget is the gzip
ceiling the script enforces.

| Consumer imports                                                 | gzip     | budget |
| ---------------------------------------------------------------- | -------- | ------ |
| `escapeHtml` from `payload-live-preview`                         | 210 B    | 214    |
| `lexicalToHtml` from `payload-live-preview`                      | 5,043 B  | 5,045  |
| `initLivePreview` from `payload-live-preview`                    | 44,584 B | 44,621 |
| `generateInlineScript` from `payload-live-preview`               | 42,211 B | 42,252 |
| `initLivePreview` from `payload-live-preview/core`               | 44,561 B | 44,599 |
| `lexicalToHtml` from `payload-live-preview/lexical`              | 5,175 B  | 5,178  |
| `morphElement` from `payload-live-preview/structural`            | 1,469 B  | 1,493  |
| `createLivePreviewMiddleware` from `payload-live-preview/nextjs` | 47,458 B | 47,500 |
| `LEAN_RUNTIME` from `payload-live-preview/lean`                  | 29,173 B | 29,203 |
| `useLivePreviewDocument` from `payload-live-preview/react`       | 5,100 B  | 5,180  |
| `useLivePreviewDocument` from `payload-live-preview/vue`         | 5,096 B  | 5,176  |
| `PluginManager` from `payload-live-preview/plugins`              | 3,315 B  | 3,372  |

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
