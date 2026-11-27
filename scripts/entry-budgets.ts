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
 * 2026-11-27 (3.0, the internal names leave the entries, ADR 0007 row 15): every row moves by
 * its measured difference against the build of the commit before, paired on Node 24.22.3 and
 * npm 12.0.2. An entry no longer loads what only its internal exports needed: `structural.js`
 * goes from 26 539 to 5 776 bytes raw, `codegen.js` from 18 209 to 12 312, the root from
 * 372 577 to 370 808, and all of it from 540 911 to 537 218. The inline scripts are byte for
 * byte as before.
 *
 * A row moves by its measured difference and keeps its reserve; Brotli moves with the commit
 * timestamp, so a row keeps about 120 bytes of it.
 */

import type { BundleBudget } from './bundle-measure';

export const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  'adapters/astro/index.js': { raw: 219_025, gzip: 69_174, brotli: 58_772 },
  'adapters/astro/middleware-entry.js': { raw: 192_378, gzip: 60_633, brotli: 51_202 },
  'adapters/nextjs/client.js': { raw: 2_628, gzip: 1_166, brotli: 1_129 },
  'adapters/nextjs/index.js': { raw: 210_881, gzip: 66_812, brotli: 56_437 },
  'adapters/nuxt/client.js': { raw: 2_069, gzip: 943, brotli: 949 },
  'adapters/nuxt/index.js': { raw: 215_068, gzip: 68_139, brotli: 57_453 },
  'adapters/nuxt/module.js': { raw: 5_106, gzip: 2_083, brotli: 1_963 },
  'adapters/react/index.js': { raw: 21_828, gzip: 7_393, brotli: 6_760 },
  'adapters/sveltekit/client.js': { raw: 1_880, gzip: 895, brotli: 895 },
  'adapters/sveltekit/index.js': { raw: 213_702, gzip: 67_642, brotli: 57_182 },
  'adapters/vue/index.js': { raw: 20_170, gzip: 6_917, brotli: 6_295 },
  'annotate.js': { raw: 6_739, gzip: 3_111, brotli: 2_771 },
  'client.js': { raw: 167_372, gzip: 53_465, brotli: 45_944 },
  'codegen-astro.js': { raw: 13_902, gzip: 4_840, brotli: 4_443 },
  'codegen-cli.js': { raw: 25_200, gzip: 8_830, brotli: 8_033 },
  'codegen.js': { raw: 12_390, gzip: 4_204, brotli: 3_881 },
  'core.js': { raw: 189_461, gzip: 60_923, brotli: 52_140 },
  'doctor-cli.js': { raw: 71_160, gzip: 24_127, brotli: 21_398 },
  'fragment.js': { raw: 36_852, gzip: 13_079, brotli: 11_723 },
  'index.js': { raw: 371_238, gzip: 117_181, brotli: 77_720 },
  'lexical.js': { raw: 19_852, gzip: 6_839, brotli: 6_250 },
  'plugin.js': { raw: 2_330, gzip: 1_081, brotli: 972 },
  'plugins.js': { raw: 38_338, gzip: 13_308, brotli: 11_857 },
  'server.js': { raw: 19_387, gzip: 6_954, brotli: 6_336 },
  'structural.js': { raw: 5_880, gzip: 2_297, brotli: 2_133 },
};

/** Every JavaScript file under `dist/` once, each measured by itself and the sizes added: what the archive carries. */
export const ALL_JAVASCRIPT_BUDGET: BundleBudget = {
  raw: 537_706,
  gzip: 192_677,
  brotli: 170_070,
};
