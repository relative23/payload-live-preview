/**
 * The byte budgets of the build tools — codegen, the doctor, the codemods — and
 * the log of why each number is what it is. No page and no adapter bundle sees
 * any of it. Split from `entry-budgets.ts` when that log reached the 500-line
 * limit (Z37); what these rows did before then is recorded there.
 */

import type { BundleBudget } from './bundle-measure';

export const TOOL_ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // 2026-09-06 (Ü12): the codegen rows carry the annotator — the template
  // scanner, its refusal reasons and the `annotate` subcommand. It is a build
  // tool; no page and no adapter bundle sees any of it.
  'codegen-astro.js': { raw: 12_950, gzip: 4_550, brotli: 4_100 },
  'codegen-cli.js': { raw: 20_100, gzip: 6_950, brotli: 6_270 },
  'codegen.cjs': { raw: 15_300, gzip: 5_400, brotli: 4_890 },
  'codegen.js': { raw: 15_200, gzip: 5_380, brotli: 4_890 },
  //
  // 2026-09-11 (Z37, the doctor reads which defaults a script means):
  // `doctor.js` +2 158 B raw / ~+830 gzip / ~+740 brotli, `doctor-cli.js`
  // +2 175 / ~+810 / ~+730 for the same code. The bytes are the reading: the
  // wire-key table the slots are looked up in instead of four hand-kept
  // numbers, the two runtime profiles an empty slot resolves to, and the words
  // — a remedy per row and per origin (set explicitly, by `defaults: 'v1'`, or
  // read from a script that names no defaults) and the line saying a script
  // predates the marker. A command-line tool; nothing a visitor downloads. Each
  // row to its measurement plus the cushion (raw ×1.001, gzip ×1.0014); brotli
  // +130 on `doctor-cli.js` and ~100 on `doctor.js`, like `plugins.*`: neither
  // embeds the runtime, so the epoch cannot move them, and 130 would put the
  // smaller one over the 2 % the improvement hint allows.
  'doctor-cli.js': { raw: 35_233, gzip: 12_942, brotli: 11_584 },
  'doctor.js': { raw: 15_449, gzip: 6_389, brotli: 5_632 },
  'migrate.js': { raw: 13_350, gzip: 4_800, brotli: 4_320 },
};
