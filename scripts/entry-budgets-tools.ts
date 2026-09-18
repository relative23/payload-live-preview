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
  //
  // 2026-09-12: the parser loads `ts-morph` through `createRequire` on first use
  // instead of importing it, because a static import made `pll-codegen --help`
  // answer with ERR_MODULE_NOT_FOUND in a project that had not installed the
  // optional peer. No new code — one different load path — and every entry that
  // ships the parser pays ~270 B raw for it: the loader, its one sentence, and
  // the guard indirection. Each moved row to its measurement plus the cushion
  // (raw ×1.001, gzip ×1.0014, brotli +100); none of these embeds the runtime,
  // so the epoch cannot move them. `codegen.js`'s brotli ceiling still holds
  // (measured 4 888) and stays where it is. `codegen-cli.js` is unchanged and
  // passes at 20 055 / 6 948 / 6 260 — the dynamic import tried first cost
  // 1 885 B raw there, because materialising the barrel's namespace defeats the
  // tree-shaking a named import allows, and it did not even work: esbuild hoists
  // an external import to the top of the bundle out of a dynamically imported
  // module too, so the binary went on resolving the peer before its first flag.
  'codegen-astro.js': { raw: 13_070, gzip: 4_610, brotli: 4_217 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 20 100 → 20 809 (+709 B, measured 20 003 → 20 712); gzip 6 950 → 7 184 (+234 B, measured 6 946 → 7 180); brotli 6 270 → 6 593 (measured 6 473; ~120 B).
  'codegen-cli.js': { raw: 20_809, gzip: 7_192, brotli: 6_593 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 15 420 → 15 899 (+479 B, measured 15 345 → 15 824); gzip 5 530 → 5 730 (+200 B, measured 5 510 → 5 710); brotli 5 060 → 5 223 (measured 5 133; under the 2 % notice).
  'codegen.cjs': { raw: 15_899, gzip: 5_730, brotli: 5_223 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 15 230 → 15 708 (+478 B, measured 15 152 → 15 630); gzip 5 430 → 5 631 (+201 B, measured 5 410 → 5 611); brotli 4 890 → 5 164 (measured 5 074; under the 2 % notice).
  'codegen.js': { raw: 15_708, gzip: 5_631, brotli: 5_164 },
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
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 16 090 → 17 523 (+1433 B, measured 16 073 → 17 506); gzip 6 550 → 6 963 (+413 B, measured 6 539 → 6 952); brotli 5 780 → 6 143 (measured 6 023, -243 B left; ~120 B as the other brotli rows).
  // 2026-09-16 (2.0.1: the probe drops a caller header that respells one of its own): raw 17 523 → 17 701 (+178 B, measured 17 506 → 17 684); gzip 6 963 → 7 023 (+60 B, measured 6 952 → 7 012). Same cushions.
  // 2026-09-16 (2.0.1: --param, the byte-for-byte query splice, the duplicate-header refusal): raw 17 701 → 18 619 (+918 B, measured 17 684 → 18 602); gzip 7 023 → 7 378 (+355 B, measured 7 012 → 7 367); brotli 6 143 → 6 513 (measured 6 393, ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 18 619 → 19 210 (+591 B, measured 18 602 → 19 193); gzip 7 378 → 7 600 (+222 B, measured 7 367 → 7 589); brotli 6 513 → 6 711 (measured 6 591; ~120 B).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 19 210 → 19 261 (+51 B, measured 19 193 → 19 244); gzip 7 600 → 7 624 (+24 B, measured 7 589 → 7 613).
  'doctor.js': { raw: 19_261, gzip: 7_625, brotli: 6_711 },
  //
  // 2026-09-12 (pll migrate reports a read key 2.0 has no home for): the
  // codemod carries the option lists of `ReadDocumentOptions`/`ReadGlobalOptions`
  // and one sentence naming the key it cannot place — `+415 B raw` on
  // `doctor-cli.js` and `+423` on `migrate.js`, which is the same code twice:
  // the `pll` binary hosts `pll migrate`. The bytes are the finding: the
  // migrated file used to fail at tsc with TS2353 while the conflicts the run
  // reported named neither line. Each row to its measurement plus the cushion
  // (raw ×1.001, gzip ×1.0014); brotli +130 and +100 as in Z37 — neither entry
  // embeds the runtime, so the epoch cannot move them.
  //
  // 2026-09-12 (the authorized boolean stops passing under the new name): one
  // more sentence in the same two entries, +430 B raw each — it names the value
  // 2.0 refuses where the codemod used to rename the key and leave `true`
  // standing, which failed at tsc with TS2322 and was reported nowhere. Same
  // cushions. `doctor-cli.js`'s brotli ceiling still holds (measured 11 732
  // against 11 745) and is left where it is, like `codegen-cli.js` before it: a
  // ceiling that is not red does not move because its neighbours did.
  //
  // 2026-09-12 (the doctor stops calling SAMEORIGIN a block it cannot have
  // established): LP0703 carries a second reading now — a warning that names the
  // condition and asks for `--admin` — so the finding is two texts instead of
  // one, +598 B raw on `doctor-cli.js` and +624 on `doctor.js`. The bytes are
  // the correction: the error it replaced was false on every deployment whose
  // admin shares the origin, and the audit exited 2 on a page with nothing wrong
  // with it. Same cushions; neither entry embeds the runtime.
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 36 760 → 39 806 (+3046 B, measured 36 718 → 39 764); gzip 13 390 → 14 373 (+983 B, measured 13 371 → 14 354); brotli 11 980 → 12 804 (measured 12 684, -704 B left; ~120 B as the other brotli rows).
  // 2026-09-16 (2.0.1: the same probe change through the CLI): raw 39 806 → 39 986 (+180 B, measured 39 764 → 39 944); gzip 14 373 → 14 428 (+55 B, measured 14 354 → 14 409). Same cushions.
  // 2026-09-16 (2.0.1: the same through the CLI, plus its --param parsing): raw 39 986 → 41 836 (+1850 B, measured 39 944 → 41 794); gzip 14 428 → 15 011 (+583 B, measured 14 409 → 14 992); brotli 12 804 → 13 388 (measured 13 268, ~120 B).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 41 836 → 43 141 (+1305 B, measured 41 794 → 43 099); gzip 15 011 → 15 403 (+392 B, measured 14 992 → 15 384); brotli 13 388 → 13 744 (measured 13 624; ~120 B).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 43 141 → 43 874 (+733 B, measured 43 099 → 43 832); gzip 15 403 → 15 564 (+161 B, measured 15 384 → 15 545); brotli 13 744 → 13 903 (measured 13 624 → 13 783, cushion kept).
  'doctor-cli.js': { raw: 43_874, gzip: 15_564, brotli: 13_903 },
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 14 220 → 14 534 (+314 B, measured 14 203 → 14 517); gzip 5 110 → 5 265 (+155 B, measured 5 100 → 5 255); brotli 4 630 → 4 750 (measured 4 657; below the 2 % notice, which ~120 B would cross on a file this small).
  'migrate.js': { raw: 14_534, gzip: 5_267, brotli: 4_750 },
};
