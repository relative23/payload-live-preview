/**
 * Browser-consumed entry budgets and their measured change history.
 * The aggregate table imports these rows unchanged; the split keeps future
 * measurements within the repository's per-file limit.
 */
import type { BundleBudget } from './bundle-measure';

export const CLIENT_ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): raw +44 B each, the fix's own bytes; cushions kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 128 734 → 128 768 (+34 B, measured 128 713 → 128 747).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 128 768 → 128 817 (+49 B, measured 128 747 → 128 796); gzip 40 643 → 40 656 (+13 B, measured 40 635 → 40 648).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 128 817 → 128 950 (+133 B, measured 128 796 → 128 929); gzip 40 656 → 40 697 (+41 B, measured 40 648 → 40 689).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 128 950 → 129 405 (+455 B, measured 128 929 → 129 384); gzip 40 697 → 40 810 (+113 B, measured 40 690 → 40 803); brotli 35 222 → 35 291 (measured 35 188 → 35 231, cushion kept).
  // 2026-09-27 (PHD-05): guarded island handoff/deduplication, measured
  // +178/+66/+21 B; retain 21/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +2070/+594/+528 B; same 21/12/120 B cushions.
  'client.cjs': { raw: 143_300, gzip: 44_669, brotli: 38_780 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 128 653 → 128 687 (+34 B, measured 128 632 → 128 666); brotli 35 116 → 35 236 (measured 35 116, 0 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 128 687 → 128 736 (+49 B, measured 128 666 → 128 715); gzip 40 630 → 40 644 (+14 B, measured 40 621 → 40 635).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 128 736 → 128 869 (+133 B, measured 128 715 → 128 848); gzip 40 644 → 40 684 (+40 B, measured 40 635 → 40 675).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 128 869 → 129 324 (+455 B, measured 128 848 → 129 303); gzip 40 684 → 40 796 (+112 B, measured 40 676 → 40 788); brotli 35 236 → 35 326 (measured 35 170 → 35 260, cushion kept).
  // 2026-09-27 (PHD-05): measured +178/+67/+79 B; same 21/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +2070/+594/+451 B; same 21/12/120 B cushions.
  'client.js': { raw: 143_219, gzip: 44_657, brotli: 38_692 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 018 → 7 028 (+10 B, measured 7 010 → 7 020); brotli 6 322 → 6 425 (measured 6 305, 17 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 20 003 → 20 136 (+133 B, measured 19 916 → 20 049); gzip 7 028 → 7 069 (+41 B, measured 7 020 → 7 061).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 20 136 → 20 368 (+232 B, measured 20 049 → 20 281); gzip 7 069 → 7 122 (+53 B, measured 7 061 → 7 114).
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1110/+350/+307 B; same 87/12/87 B cushions.
  'structural.cjs': { raw: 21_730, gzip: 7_576, brotli: 6_869 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 019 → 7 029 (+10 B, measured 7 014 → 7 024); brotli 6 326 → 6 427 (measured 6 307, 19 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 19 958 → 20 091 (+133 B, measured 19 870 → 20 003); gzip 7 029 → 7 068 (+39 B, measured 7 024 → 7 063).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 20 091 → 20 323 (+232 B, measured 20 003 → 20 235); gzip 7 068 → 7 120 (+52 B, measured 7 063 → 7 115).
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1100/+347/+308 B; same 88/12/90 B cushions.
  'structural.js': { raw: 21_685, gzip: 7_577, brotli: 6_885 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 768 → 91 802 (+34 B, measured 91 749 → 91 783).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 802 → 91 851 (+49 B, measured 91 783 → 91 832); gzip 29 177 → 29 190 (+13 B, measured 29 171 → 29 184).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 851 → 91 869 (+18 B, measured 91 832 → 91 850); gzip 29 190 → 29 197 (+7 B, measured 29 184 → 29 191).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 91 869 → 92 310 (+441 B, measured 91 850 → 92 291); gzip 29 197 → 29 316 (+119 B, measured 29 193 → 29 312); brotli 25 916 → 26 068 (measured 25 854 → 26 006, cushion kept).
  // 2026-09-27 (PHD-05): measured +167/+107/+79 B; same 9/6/133 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+10/-42 B; same 9/6/133 B cushions.
  'lean.cjs': { raw: 102_726, gzip: 32_269, brotli: 28_584 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 757 → 91 791 (+34 B, measured 91 738 → 91 772).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 791 → 91 840 (+49 B, measured 91 772 → 91 821); gzip 29 171 → 29 183 (+12 B, measured 29 167 → 29 179).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 840 → 91 858 (+18 B, measured 91 821 → 91 839); gzip 29 183 → 29 190 (+7 B, measured 29 179 → 29 186).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 91 858 → 92 299 (+441 B, measured 91 839 → 92 280); gzip 29 190 → 29 309 (+119 B, measured 29 188 → 29 307); brotli 25 929 → 26 079 (measured 25 834 → 25 984, cushion kept).
  // 2026-09-27 (PHD-05): measured +167/+108/+57 B; same 9/6/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+10/-1 B; same 9/6/120 B cushions.
  'lean.js': { raw: 102_715, gzip: 32_264, brotli: 28_560 },
  // 2026-09-16 (2.0.1 Version PR): gzip 5 602 → 5 612. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 5 600 against a cushion of 2 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 307 → 16 527 (+220 B, measured 16 305 → 16 525); gzip 5 612 → 5 665 (+53 B, measured 5 600 → 5 653); brotli 5 072 → 5 162 (measured 5 072; under the 2 % notice).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 16 527 → 16 755 (+228 B, measured 16 525 → 16 753); gzip 5 665 → 5 720 (+55 B, measured 5 653 → 5 708).
  'lexical.cjs': { raw: 17_429, gzip: 5_906, brotli: 5_392 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 278 → 16 490 (+212 B, measured 16 276 → 16 488); gzip 5 606 → 5 658 (+52 B, measured 5 602 → 5 654); brotli 5 079 → 5 165 (measured 5 075; under the 2 % notice).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 16 490 → 16 718 (+228 B, measured 16 488 → 16 716); gzip 5 658 → 5 715 (+57 B, measured 5 654 → 5 711).
  'lexical.js': { raw: 17_392, gzip: 5_914, brotli: 5_393 },
  //
  // 2026-09-06 (Ü10): `plugins.*` rise ~2 900 raw / ~1 150 gzip for the
  // unbound-fields overlay — the development panel that lists the fields an
  // update carried and the page cannot show. It is a plugin precisely so this
  // row moves and `INLINE_BUDGET` does not: no page carries it unless its own
  // code asks for it.
  // The `plugins.*` brotli rows carry ~100 B over their measurement rather than
  // the ~130 the runtime-carrying rows keep: this entry embeds no runtime, so
  // the epoch that moves `generatedAt` cannot move it, and at 6 KB the wider
  // cushion is over the 2 % the improvement hint allows (measured after the
  // Z9 commit: 6 179 / 6 163).
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+12/+6 B; same 86/37/61 B cushions.
  'plugins.cjs': { raw: 19_378, gzip: 7_135, brotli: 6_292 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+12/+1 B; same 86/33/92 B cushions.
  'plugins.js': { raw: 19_354, gzip: 7_119, brotli: 6_297 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1311/+423/+399 B; same 20/3/84 B cushions.
  'fragment.cjs': { raw: 16_467, gzip: 6_284, brotli: 5_633 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1311/+429/+364 B; same 20/9/79 B cushions.
  'fragment.js': { raw: 16_401, gzip: 6_256, brotli: 5_590 },
};
