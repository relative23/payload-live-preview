/**
 * Tree shaking, measured. A consumer that imports one symbol must ship that
 * symbol's code, not the barrel it came from: each fixture is a one-line
 * consumer bundled with Vite through a real `node_modules` resolution, so the
 * manifest's `exports` and `sideEffects` decide what survives.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { improvementNotice } from './size-budget-notice';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Fixture {
  /** The specifier the consumer imports from. */
  readonly from: string;
  /** The one symbol it imports. */
  readonly symbol: string;
  /** How the consumer uses it, so nothing is dropped as unused. */
  readonly use: string;
  /** Gzip budget in bytes. */
  readonly gzip: number;
  /** What the number stands for. */
  readonly why: string;
}

/**
 * Measured 2026-08-27; headroom ~1.5 %.
 *
 * The three client rows and the generator row rose twice on 2026-09-06: for the
 * lean profile's own code (the LP0104 message, the renderers that report it, the two
 * strategy warnings as shared functions). The lean artifact itself is not in any
 * of them: it lives behind `payload-live-preview/lean`, measured below. Then
 * again for LP0503, the line a page prints when a trusted admin sends a message
 * this runtime does not recognise.
 *
 * 2026-09-07 (Z3): the four rows that carry the runtime and the lean row rise
 * for the fidelity verdict — `initLivePreview` from the barrel 39 236 → 39 650
 * (measured 39 588), from `./core` 39 211 → 39 590 (39 532), the generator
 * 37 151 → 37 440 (37 383), the Next.js middleware 42 011 → 42 280 (42 221) and
 * `LEAN_RUNTIME` 25 890 → 26 240 (26 198). Same ~440 B gzip as every other row
 * that embeds the runtime; the reason is in bundle-budgets.ts.
 *
 * The three rows carrying the inline runtime were raised on 2026-09-06 for the
 * ~660 B gzip `onUnboundChange` costs it (see bundle-budgets.ts). The generator
 * row moved furthest because it also gained the route prelude alongside the
 * fragment one — a second copy of the runtime's own strategy source, which the
 * generator embeds whole and cannot shake. Raised again the same day for
 * `data-payload-format`.
 *
 * 2026-09-06: the numbers are Vite 7's, because that is the newest major the
 * repository's own dev tooling accepts (`@codspeed/vitest-plugin` peers below
 * 8) — the record and the reason live in `quality/compat-matrix.json`.
 *
 * Vite 8 was measured before that constraint surfaced, and the measurement is
 * worth keeping: it bundles with Rolldown instead of Rollup, which is less
 * precise at dropping unused declarations out of a bundled module —
 * `escapeHtml` from the barrel came out at 2 378 B against Rollup's 220, and
 * `payload-live-preview/plugins` about a fifth larger. Consumers on Astro 7 or
 * Nuxt get that bundler, so the difference is theirs, not ours; the focused
 * entries were within a few percent either way.
 *
 * One thing did not survive the move unassisted, and its fix is still in
 * place. The runtime source is emitted as chunks joined at load
 * (scripts/serialize-source.ts), and Rolldown would not prove that call pure:
 * importing `escapeHtml` from the barrel came out at 32 512 B gzip — the whole
 * package — until the expression was annotated `\/* @__PURE__ *\/`. Rollup drops
 * it either way, so the annotation costs nothing here and is what keeps the
 * barrel shakeable for a consumer on 8.
 *
 * 2026-09-06 (LP0409): the two Lexical rows rise ~350 B gzip. The renderer
 * writes sanitized HTML, so it pulls the sanitizer, and the sanitizer now
 * carries the message it prints when the strict policy drops an attribute the
 * 1.x default kept.
 *
 * 2026-09-07 (LP0410): the same two rows rise ~25 B gzip (5 118 → 5 145,
 * measured 5 143; 5 251 → 5 275, measured 5 272). A `block` node whose slug has
 * no registered renderer now says so once, naming the slug to register — until
 * now the only sign was an empty `<div class="lp-block ...">` where the block
 * should be, in a preview that keeps the server's markup for it (see
 * bundle-budgets.ts). The line and its warned-once set are all these rows
 * carry; the write path that keeps the markup is in the field renderers, which
 * this entry does not pull.
 *
 * 2026-09-07 (Z4): the same five runtime-carrying rows rise for the merge
 * decision and the window a burst of requests shares — `initLivePreview` from
 * the barrel 39 650 -> 40 570 (measured 40 505), from `./core` 39 590 -> 40 530
 * (40 468), the generator 37 440 -> 38 270 (38 215), the Next.js middleware
 * 42 280 -> 43 120 (43 059) and `LEAN_RUNTIME` 26 240 -> 27 060 (27 018). The
 * same ~830 B gzip every artifact with the runtime pays; what it buys is in
 * bundle-budgets.ts, and it is a request per keystroke rather than a behaviour.
 *
 * 2026-09-07 (Z5): the leading write of a quiet phase costs ~50 B gzip in every
 * runtime-carrying row, and only one of the five had that little left:
 * `LEAN_RUNTIME` 27 060 -> 27 100 (measured 27 062). The other four sit between
 * 5 and 21 B under their ceilings and stay where Z4 left them. What the bytes
 * buy is 50 ms off a keystroke; see bundle-budgets.ts. *
 * 2026-09-07 (Z6): the trailing run of a refused route refresh and the counter
 * that stops calling it a failure cost ~100 B gzip in every runtime-carrying
 * row: `initLivePreview` from the barrel 40 570 -> 40 700 (measured 40 663),
 * from `./core` 40 530 -> 40 670 (40 630), the generator 38 270 -> 38 650
 * (38 598) and the Next.js middleware 43 120 -> 43 460 (43 414). `LEAN_RUNTIME`
 * holds at 27 100 (27 098): the lean profile has no route strategy, and all it
 * pays is the cancelled timer's slot in the runtime state.
 *
 * 2026-09-07 (Z7): LP0201 reaching one level into a group costs ~80 B gzip, and
 * this time all five runtime-carrying rows crossed: `initLivePreview` from the
 * barrel 40 700 -> 40 790 (measured 40 746), from `./core` 40 670 -> 40 760
 * (40 712), the generator 38 650 -> 38 720 (38 681), the Next.js middleware
 * 43 460 -> 43 540 (43 501) and `LEAN_RUNTIME` 27 100 -> 27 220 (27 170). The
 * diagnostic is in the update pipeline, which every one of them carries; what
 * the bytes buy is in bundle-budgets.ts.
 *
 * 2026-09-07 (Z22): an item rebuilt from a template keeping the attributes its
 * predecessors shared costs ~200-440 B gzip in the four rows that carry an array
 * renderer: `initLivePreview` from the barrel 40 790 -> 41 000 (measured
 * 40 955), from `./core` 40 760 -> 40 950 (40 900), the generator 38 720 ->
 * 39 160 (39 112) and the Next.js middleware 43 540 -> 43 990 (43 939).
 * `LEAN_RUNTIME` holds at 27 220 (27 174): the lean profile has no array
 * renderer and no structural applier, so all it pays is the shared attribute
 * rule. What the bytes buy is in bundle-budgets.ts.
 *
 * 2026-09-10 (Z9): auto-binding costs ~1 360 B gzip in the four rows that carry
 * the full runtime — `initLivePreview` from the barrel 41 330 -> 42 920
 * (measured 42 866), from `./core` 41 290 -> 42 860 (42 812), the generator
 * 39 500 -> 40 560 (40 508) and the Next.js middleware 44 330 -> 45 410
 * (45 358) — and ~190 B in `LEAN_RUNTIME` 27 510 -> 27 750 (27 697), which
 * carries the option, the marker and the LP0104 line but not the search. What
 * the bytes buy, and the seam that would take them out of a page that leaves
 * the option off, is in bundle-budgets.ts.
 *
 * 2026-09-10 (Z25): the frozen diagnostic-code table leaves the runtime, and
 * the four rows that carry the full one fall ~520 B gzip — `initLivePreview`
 * from the barrel 42 916 -> 42 402 (measured 42 352), from `./core` 42 862 ->
 * 42 352 (42 302), the generator 40 558 -> 40 034 (39 984) and the Next.js
 * middleware 45 408 -> 44 879 (44 829). `LEAN_RUNTIME` holds at 27 747
 * (27 697): the lean profile never carried the table. See bundle-budgets.ts.
 *
 * 2026-09-10 (Z26): keeping a guess through a route refresh costs ~300 B gzip
 * in the four rows that carry the full runtime — `initLivePreview` from the
 * barrel 42 402 -> 42 775 (measured 42 725), from `./core` 42 352 -> 42 721
 * (42 671), the generator 40 034 -> 40 336 (40 281) and the Next.js middleware
 * 44 879 -> 45 179 (45 124). `LEAN_RUNTIME` holds at 27 747 (27 728): the
 * lean profile has no route strategy. See bundle-budgets.ts.
 *
 * 2026-09-11 (Z28): ten rows fall with the runtime and the helpers it shares,
 * each to its measurement plus the cushion it carried — `escapeHtml` from `payload-live-preview` 224 → 214 (210); `lexicalToHtml` from `payload-live-preview` 5_145 → 5_080 (5_078); `initLivePreview` from `payload-live-preview` 42_775 → 42_577 (42_527); `generateInlineScript` from `payload-live-preview` 40_336 → 40_202 (40_147); `initLivePreview` from `payload-live-preview/core` 42_721 → 42_537 (42_487); `lexicalToHtml` from `payload-live-preview/lexical` 5_275 → 5_203 (5_200); `createLivePreviewMiddleware` from `payload-live-preview/nextjs` 45_179 → 45_046 (44_991); `LEAN_RUNTIME` from `payload-live-preview/lean` 27_747 → 27_587 (27_568); `useLivePreviewDocument` from `payload-live-preview/react` 5_322 → 5_180 (5_100); `useLivePreviewDocument` from `payload-live-preview/vue` 5_311 → 5_176 (5_096).
 * The bytes are lines the trusted core's mutation run showed no test could
 * reach; see bundle-budgets.ts.
 *
 * 2026-09-11 (Z30): the five rows that carry the runtime rise by its +764 B raw
 * (~+180 gzip) — `initLivePreview` from `payload-live-preview` 42_577 → 42_809
 * (42_759), `generateInlineScript` 40_202 → 40_381 (40_326), `initLivePreview`
 * from `payload-live-preview/core` 42_537 → 42_785 (42_735),
 * `createLivePreviewMiddleware` from `payload-live-preview/nextjs` 45_046 →
 * 45_225 (45_170), `LEAN_RUNTIME` from `payload-live-preview/lean` 27_587 →
 * 27_760 (27_741) — and the two Lexical rows fall, because the warn-once for a
 * block with no renderer left the node renderer for the rich-text write:
 * `lexicalToHtml` from `payload-live-preview` 5_080 → 5_032 (5_030), from
 * `payload-live-preview/lexical` 5_203 → 5_165 (5_162). Each to its
 * measurement plus the cushion it carried; see bundle-budgets.ts.
 *
 * 2026-09-11 (Z29): the same five rows rise by the runtime's +293 B raw
 * (~+100 gzip) for the wrapper the block-keeping write now pairs inside of —
 * `initLivePreview` from `payload-live-preview` 42_809 → 42_928 (42_876),
 * `generateInlineScript` 40_381 → 40_477 (40_420), `initLivePreview` from
 * `payload-live-preview/core` 42_785 → 42_901 (42_849),
 * `createLivePreviewMiddleware` from `payload-live-preview/nextjs` 45_225 →
 * 45_319 (45_263), `LEAN_RUNTIME` from `payload-live-preview/lean` 27_760 →
 * 27_865 (27_843). The Lexical rows do not move: the wrapper is the write's
 * business, not the renderer's. Each to its measurement plus the cushion it
 * carried; see bundle-budgets.ts.
 *
 * 2026-09-11 (Z27): the same five rows rise by the runtime's +1 925 B raw
 * (~+710 gzip) for the wait for React's first commit (ADR 0015) —
 * `initLivePreview` from `payload-live-preview` 42_928 → 43_798 (43_746),
 * `generateInlineScript` 40_477 → 41_192 (41_135; the generator also carries
 * the bootstrap built armed for React that it emits for a Next asset page),
 * `initLivePreview` from `payload-live-preview/core` 42_901 → 43_773 (43_721),
 * `createLivePreviewMiddleware` from `payload-live-preview/nextjs` 45_319 →
 * 46_374 (46_318; the armed bootstrap and the page facts the adapter threads
 * through), `LEAN_RUNTIME` from `payload-live-preview/lean` 27_865 → 28_578
 * (28_556). The Lexical, React and Vue rows do not move: the wait is in
 * `start()`, which none of them runs. Each to its measurement plus the
 * cushion it carried; see bundle-budgets.ts.
 *
 * 2026-09-11 (Z31): the same five rows rise by the runtime's +1 085 B raw
 * (~+330 gzip) for the wait for Vue's mount (ADR 0015, addendum) —
 * `initLivePreview` from `payload-live-preview` 43_798 → 44_187 (44_135),
 * `generateInlineScript` 41_192 → 41_520 (41_463), `initLivePreview` from
 * `payload-live-preview/core` 43_773 → 44_160 (44_108),
 * `createLivePreviewMiddleware` from `payload-live-preview/nextjs` 46_374 →
 * 46_707 (46_651), `LEAN_RUNTIME` from `payload-live-preview/lean` 28_578 →
 * 28_909 (28_887). No bootstrap moved this time: Vue's mount is state a late
 * runtime reads, so the generator carries no third bootstrap. The Lexical,
 * React and Vue rows do not move — the composable never runs `start()`. Each
 * to its measurement plus the cushion it carried; see bundle-budgets.ts.
 *
 * 2026-09-11 (merge of main #64/#65): the five gzip rows that carry the runtime
 * rise by the measured difference between the last green build (36fd5ec) and
 * the merged tree (+120…190 B gzip); each keeps the cushion it carried.
 *
 * 2026-09-11 (Z37): the two rows that carry the generator rise for the
 * `defaults` profile it now resolves itself — the 1.x row table and the
 * function that writes it, plus the marker in the last slot —
 * `generateInlineScript` from `payload-live-preview` 41_698 → 41_788
 * (41_731, +202 raw), `createLivePreviewMiddleware` from
 * `payload-live-preview/nextjs` 46_955 → 47_038 (46_982, +77 raw). The runtime
 * did not move, so the rows that carry only the runtime keep theirs. Each to
 * its measurement plus the cushion it carried.
 *
 * 2026-09-12 (Testlauf B, F1): the same five rows rise again, each by the
 * measured difference with its cushion kept — `initLivePreview` from the
 * barrel 44_366 → 44_520 (measured 44_466), from `./core` 44_334 → 44_491
 * (44_437), the generator 41_788 → 41_873 (41_815), the Next.js middleware
 * 47_038 → 47_118 (47_060) and `LEAN_RUNTIME` 29_064 → 29_159 (29_136). The
 * unbound change reaches the fidelity ledger; the reason is in bundle-budgets.ts.
 * Raised 2026-09-12 (B-01): the barrel 44_520 → 44_621 (measured 44_567), from
 * `./core` 44_491 → 44_599 (44_545), the generator 41_873 → 42_252 (42_194) and
 * the Next.js middleware 47_118 → 47_500 (47_442) — each row by its own measured
 * difference, every cushion kept. An array row that lacks one of the template's
 * fields writes nothing where it used to write the placeholder itself; the keys
 * any row carries are collected once per render and both callers pass them down.
 * `LEAN_RUNTIME`, `morphElement` and the two renderer rows do not move: none of
 * them pulls in the array path.
 *
 * 2026-09-14 (2.0.1, three diagnostics): the two Lexical rows rise by +13 gzip,
 * because `lexicalToHtml` writes through the sanitizer and LP0409 now asks
 * whether `compat` would have kept `name` before it reports —
 * `lexicalToHtml` from `payload-live-preview` 5_032 → 5_045 (5_030 → 5_043),
 * from `payload-live-preview/lexical` 5_165 → 5_178 (5_162 → 5_175). Measured
 * against origin/main on the same host; each keeps the cushion it carried.
 *
 * 2026-09-17 (2.0.2): the shared sanitizer document and the longer server
 * warning reach every consumer that carries the sanitizer, each row rising by
 * its measured difference against 2.0.1 and keeping its cushion — `lexicalToHtml` from `payload-live-preview` 5_045 → 5_090 (5_043 → 5_088); `initLivePreview` from `payload-live-preview` 44_621 → 44_646 (44_601 → 44_626); `initLivePreview` from `payload-live-preview/core` 44_599 → 44_628 (44_579 → 44_608); `lexicalToHtml` from `payload-live-preview/lexical` 5_178 → 5_219 (5_175 → 5_216).
 */
export const TREE_SHAKING_FIXTURES: readonly Fixture[] = [
  {
    from: 'payload-live-preview',
    symbol: 'escapeHtml',
    use: 'export const out = escapeHtml(String(Date.now()));',
    gzip: 214,
    why: 'a pure helper from the root barrel: the barrel itself costs nothing',
  },
  {
    from: 'payload-live-preview',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 5_090,
    why: 'the Lexical renderer from the root barrel, on par with payload-live-preview/lexical',
  },
  {
    from: 'payload-live-preview',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 44_646,
    why: 'the client with its built-in renderers from the root barrel, on par with payload-live-preview/client',
  },
  {
    from: 'payload-live-preview',
    symbol: 'generateInlineScript',
    use: 'export const out = generateInlineScript({});',
    gzip: 42_252,
    why: 'the generator carries the inline runtime source and nothing of the client (the lean one lives behind payload-live-preview/lean)',
  },
  {
    from: 'payload-live-preview/core',
    symbol: 'initLivePreview',
    use: 'export const out = initLivePreview({});',
    gzip: 44_628,
    why: 'the client from the core entry: the same code, the same size',
  },
  {
    from: 'payload-live-preview/lexical',
    symbol: 'lexicalToHtml',
    use: 'export const out = lexicalToHtml({ root: { children: [] } });',
    gzip: 5_219,
    why: 'the Lexical renderer from its focused entry',
  },
  {
    from: 'payload-live-preview/structural',
    symbol: 'morphElement',
    use: 'export const out = morphElement(document.body, document.body, { keyAttributes: [] });',
    gzip: 1_493,
    why: 'the keyed morph alone, without the array renderer',
  },
  {
    from: 'payload-live-preview/nextjs',
    symbol: 'createLivePreviewMiddleware',
    use: 'export const out = createLivePreviewMiddleware({});',
    gzip: 47_500,
    why: 'the Next.js middleware without the fragment endpoint: ~2.4 KB gzip less than the whole entry, so a project that registers no fragment ships none of it. It does carry the bootstrap source, because delivery is decided where the script body is built',
  },
  {
    from: 'payload-live-preview/lean',
    symbol: 'LEAN_RUNTIME',
    use: 'export const out = LEAN_RUNTIME.source.length;',
    gzip: 29_203,
    why: 'the lean artifact as a value: the embedded script and nothing else, so a project that never imports it pays nothing',
  },
  {
    from: 'payload-live-preview/react',
    symbol: 'useLivePreviewDocument',
    use: 'export const out = useLivePreviewDocument;',
    gzip: 5_180,
    why: 'the hook: the message bus, the origin detector and the merger, and nothing that touches an element (Vite re-bundles unminified, hence above the 4 637 published bytes)',
  },
  {
    from: 'payload-live-preview/vue',
    symbol: 'useLivePreviewDocument',
    use: 'export const out = useLivePreviewDocument;',
    gzip: 5_176,
    why: 'the composable: the same session as the React hook, with Vue reactivity instead',
  },
  {
    from: 'payload-live-preview/plugins',
    symbol: 'PluginManager',
    use: 'export const out = PluginManager;',
    gzip: 3_372,
    why: 'the plugin manager without the built-in plugins',
  },
];

function slug(fixture: Fixture): string {
  return `${fixture.from.replace(/[^a-z]/gu, '-')}--${fixture.symbol}`;
}

async function bundle(consumer: string, fixture: Fixture): Promise<string> {
  const entry = join(consumer, `${slug(fixture)}.ts`);
  await writeFile(entry, `import { ${fixture.symbol} } from '${fixture.from}';\n${fixture.use}\n`);
  const result = await build({
    root: consumer,
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      minify: 'esbuild',
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'out' },
      // The optional peers a fixture must not inline: measuring React would
      // measure React, not what this package ships.
      rollupOptions: { external: ['ts-morph', 'react', 'vue'] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const first = outputs[0];
  if (first === undefined || !('output' in first)) throw new Error('vite produced no output');
  const chunk = first.output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error(`no chunk for ${slug(fixture)}`);
  return chunk.code;
}

async function main(): Promise<void> {
  const consumer = await mkdtemp(join(tmpdir(), 'payload-live-preview-treeshake-'));
  const failures: string[] = [];
  try {
    // A real consumer: the package resolves through node_modules, so the
    // manifest's `exports` and `sideEffects` apply exactly as they would after
    // `npm install`.
    await mkdir(join(consumer, 'node_modules'));
    await symlink(ROOT, join(consumer, 'node_modules', 'payload-live-preview'), 'dir');
    await writeFile(
      join(consumer, 'package.json'),
      '{ "name": "treeshake-consumer", "type": "module", "private": true }\n',
    );
    for (const fixture of TREE_SHAKING_FIXTURES) {
      const code = await bundle(consumer, fixture);
      const raw = Buffer.byteLength(code);
      const gzip = gzipSync(code, { level: 9 }).byteLength;
      const ok = gzip <= fixture.gzip;
      console.log(
        `${ok ? 'PASS' : 'FAIL'} import { ${fixture.symbol} } from '${fixture.from}': ${String(raw)} raw / ${String(gzip)} gzip (budget ${String(fixture.gzip)}) — ${fixture.why}`,
      );
      const notice = improvementNotice(
        `import { ${fixture.symbol} } from '${fixture.from}'`,
        gzip,
        fixture.gzip,
      );
      if (notice !== undefined) console.log(notice);
      if (!ok) failures.push(`${fixture.from} → ${fixture.symbol}`);
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    throw new Error(`tree-shaking gate failed for ${failures.join(', ')}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
