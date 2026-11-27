/**
 * The byte budgets of the built package, one row per entry and one for the whole.
 *
 * Since 3.0 the package is one module graph (ADR 0012): the entries share chunks, so a row
 * measures an entry's closure, its own file with every chunk it loads, in the order the build
 * reaches them (`entry-closure.ts`). That is what Node parses when a project imports the entry
 * unbundled. What a bundler keeps of it for one imported name is the tree-shaking gate's
 * question (`tree-shaking-budgets.ts`), and the closures count a shared chunk once per entry,
 * so `ALL_JAVASCRIPT_BUDGET` holds what the archive carries: every file once.
 *
 * 2026-11-27 (3.0, one module graph, ADR 0007 row 43): the table starts again on the new
 * measure. Until then a row was one self-contained file, and the notes of each row, back to
 * 2.0, are in this file's history and in the four files that held the adapter, client, payload
 * and tool rows. Paired on Node 24.22.3 and npm 12.0.2 against the build of the commit before:
 * each row is the measured closure plus the reserve its file had (raw, gzip and Brotli each),
 * and the row of the whole takes the reserves of the root entry. A closure is larger than the
 * file was, since a chunk carries what any of its entries needs: the four adapters by 3 to 5 %,
 * the root by 6 %, `core.js` by 14 %, the hooks by 21 and 23 %, `plugins.js` by 72 % and
 * `fragment.js` by 120 %. All of it is 541 124 bytes in 66 files, against 2 751 547 in the
 * build before, 1 956 570 of them ESM.
 *
 * A row moves by its measured difference and keeps its reserve; Brotli moves with the commit
 * timestamp, so a row keeps about 120 bytes of it.
 */

import type { BundleBudget } from './bundle-measure';

export const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  'adapters/astro/index.js': { raw: 219_536, gzip: 69_395, brotli: 58_908 },
  'adapters/astro/middleware-entry.js': { raw: 192_718, gzip: 60_772, brotli: 51_375 },
  'adapters/nextjs/client.js': { raw: 2_628, gzip: 1_166, brotli: 1_129 },
  'adapters/nextjs/index.js': { raw: 211_181, gzip: 66_927, brotli: 56_500 },
  'adapters/nuxt/client.js': { raw: 2_069, gzip: 943, brotli: 949 },
  'adapters/nuxt/index.js': { raw: 215_525, gzip: 68_321, brotli: 57_674 },
  'adapters/nuxt/module.js': { raw: 5_166, gzip: 2_116, brotli: 2_002 },
  'adapters/react/index.js': { raw: 22_072, gzip: 7_463, brotli: 6_806 },
  'adapters/sveltekit/client.js': { raw: 1_880, gzip: 895, brotli: 895 },
  'adapters/sveltekit/index.js': { raw: 214_133, gzip: 67_800, brotli: 57_360 },
  'adapters/vue/index.js': { raw: 20_414, gzip: 6_988, brotli: 6_357 },
  'annotate.js': { raw: 6_888, gzip: 3_148, brotli: 2_802 },
  'client.js': { raw: 168_510, gzip: 53_545, brotli: 46_189 },
  'codegen-astro.js': { raw: 13_972, gzip: 4_901, brotli: 4_494 },
  'codegen-cli.js': { raw: 25_346, gzip: 8_890, brotli: 8_109 },
  'codegen.js': { raw: 18_287, gzip: 6_626, brotli: 6_011 },
  'core.js': { raw: 190_936, gzip: 61_094, brotli: 52_389 },
  'doctor-cli.js': { raw: 71_160, gzip: 24_127, brotli: 21_398 },
  'fragment.js': { raw: 37_327, gzip: 13_132, brotli: 11_804 },
  'index.js': { raw: 373_007, gzip: 117_688, brotli: 77_841 },
  'lexical.js': { raw: 20_276, gzip: 7_042, brotli: 6_403 },
  'plugin.js': { raw: 2_330, gzip: 1_081, brotli: 972 },
  'plugins.js': { raw: 38_581, gzip: 13_383, brotli: 11_914 },
  'server.js': { raw: 19_545, gzip: 7_030, brotli: 6_389 },
  'structural.js': { raw: 26_643, gzip: 9_325, brotli: 8_426 },
};

/** Every JavaScript file under `dist/` once, each measured by itself and the sizes added: what the archive carries. */
export const ALL_JAVASCRIPT_BUDGET: BundleBudget = {
  raw: 541_399,
  gzip: 194_363,
  brotli: 171_504,
};
