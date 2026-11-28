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
 * 2026-11-27 (3.0, one browser entry, ADR 0007 row 46): the rows of the core, plugins and
 * structural entries leave with the entries. `client.js` takes their browser names and goes
 * from 167 213 to 203 745 bytes raw (the core entry was 189 173), and the root, which exports
 * `client.js` and the server's names, from 370 808 to 379 870. Part of that is the chunking:
 * every module that defines a public name is a chunk of its own now
 * (scripts/chunk-boundaries.ts), 58 chunks where there were 39, and a boundary costs the
 * import and export lists on both sides and the short names the minifier could give across it.
 * All of it goes from 537 218 to 544 555 bytes. Every function and class the browser entry
 * exports keeps its name, and ten names kept for the internal exports that row 15 removed no
 * longer are. Paired on Node 24.22.3 and npm 12.0.2 against the build of the commit before.
 *
 * A row moves by its measured difference and keeps its reserve; Brotli moves with the commit
 * timestamp, so a row keeps about 120 bytes of it.
 */

import type { BundleBudget } from './bundle-measure';

export const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  'adapters/astro/index.js': { raw: 218_919, gzip: 69_472, brotli: 58_890 },
  'adapters/astro/middleware-entry.js': { raw: 192_695, gzip: 61_066, brotli: 51_399 },
  'adapters/nextjs/client.js': { raw: 2_426, gzip: 1_069, brotli: 1_045 },
  'adapters/nextjs/index.js': { raw: 210_502, gzip: 67_056, brotli: 56_501 },
  'adapters/nuxt/client.js': { raw: 1_867, gzip: 847, brotli: 856 },
  'adapters/nuxt/index.js': { raw: 214_979, gzip: 68_466, brotli: 57_546 },
  'adapters/nuxt/module.js': { raw: 5_106, gzip: 2_083, brotli: 1_963 },
  'adapters/react/index.js': { raw: 21_978, gzip: 7_408, brotli: 6_758 },
  'adapters/sveltekit/client.js': { raw: 1_678, gzip: 795, brotli: 803 },
  'adapters/sveltekit/index.js': { raw: 213_613, gzip: 67_969, brotli: 57_317 },
  'adapters/vue/index.js': { raw: 20_539, gzip: 7_038, brotli: 6_393 },
  'annotate.js': { raw: 6_739, gzip: 3_111, brotli: 2_771 },
  'client.js': { raw: 203_200, gzip: 65_082, brotli: 55_443 },
  'codegen-astro.js': { raw: 13_902, gzip: 4_840, brotli: 4_443 },
  'codegen-cli.js': { raw: 25_200, gzip: 8_807, brotli: 8_006 },
  'codegen.js': { raw: 12_390, gzip: 4_204, brotli: 3_881 },
  'doctor-cli.js': { raw: 73_924, gzip: 24_883, brotli: 22_068 },
  'fragment.js': { raw: 37_684, gzip: 13_237, brotli: 11_862 },
  'index.js': { raw: 379_365, gzip: 119_712, brotli: 80_000 },
  'lexical.js': { raw: 21_085, gzip: 7_226, brotli: 6_557 },
  'plugin.js': { raw: 2_330, gzip: 1_081, brotli: 972 },
  'server.js': { raw: 19_334, gzip: 6_931, brotli: 6_297 },
};

/** Every JavaScript file under `dist/` once, each measured by itself and the sizes added: what the archive carries. */
export const ALL_JAVASCRIPT_BUDGET: BundleBudget = {
  raw: 544_768,
  gzip: 198_263,
  brotli: 174_587,
};
