/**
 * Browser-consumed entry budgets and their measured change history.
 * The aggregate table imports these rows unchanged; the split keeps future
 * measurements within the repository's per-file limit.
 */
// 2026-10-16 (the json-only population body refuses an interruption, ADR 0010 addendum): paired builds at the same HEAD epoch1791096072 (Node24.19/npm12.0.2); every row that embeds
// the runtime moves by its exact measured delta (raw +12 each, +11 react/vue, +24 index barrels; gzip +2 to +11) and keeps its reserves; a Brotli budget rises only where Brotli rose.
// 2026-10-05 (ADR 0004): accepted data snapshots and owned merge outcomes; paired 2.1.0 measurements at epoch1791096072 (Node24.19/npm12.0.2) retain each row's reserves.
// 2026-10-05 (ADR 0004): trailing merge timers own their requests and handles.
// Measured against the prior 2.1.0 archive with Node24.19/npm12.0.2, epoch1791096072;
// changed rows move by their exact measured deltas and retain their previous reserves.
// 2026-10-04 (2.1.0): stop superseded merges after diagnostics and simplify legacy
// relation planning. Paired Node24.19/npm12.0.2 measurements at epoch1791096072 move
// changed rows by their measured deltas and preserve existing raw/gzip/Brotli reserves.
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
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +585/+161/+106 B; same 21/12/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+8/+35 B; same 21/12/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +73/+34/+6 B; same 21/12/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2992/+908/+728 B; same 21/12/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3310/+1081/+890 B; same 21/12/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +81/+59/+55 B; same 21/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -163/-26/-21 B; same 21/12/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +33/+7/+20 B; same 21/12/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +438/+159/+126 B; same 21/12/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +381/+147/+120 B; same 21/12/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +618/+245/+165 B; same 21/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7695/+2479/+2164 B; cushions 21/12/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8156/+2610/+2287 B raw/gzip/Brotli; reserves 21/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +317/+28/-21 B raw/gzip/Brotli; reserves 21/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +22/+10/+12 B raw/gzip/Brotli;
  // retain the prior 21/12/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +379/+132/+84 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +211/+74/+67 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +656/+186/+163 B; prior reserves kept.
  // 2026-10-26 (the 2.2 review fixes): paired Node24.22.1/npm12.0.2; +75/+18/+31 B; prior reserves kept.
  // 2026-10-28 (format and locale reach the binding): paired Node24.22.1/npm12.0.2, epoch1793120979; +46/+19/+32 B; prior reserves kept.
  // 2026-10-28 (the renderers write what the element expects): paired Node24.22.1/npm12.0.2, epoch1793120979; +1251/+445/+350 B; prior reserves kept.
  // 2026-10-28 (fidelity escalates again on a new value): paired Node24.22.1/npm12.0.2, epoch1793120979; +735/+239/+207 B; prior reserves kept.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +920/+282/+273 B; prior reserves kept.
  // 2026-10-29 (the handshake and the gate respect the page): paired Node24.22.1/npm12.0.2; +462/+159/+77 B; prior reserves kept.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +199/+45/+62 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+39/+35 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/-1/+30 B; the gzip ceiling stays, it fell; prior reserves kept.
  // 2026-10-31 (an opt-in deadline for the merge): paired Node24.22.1/npm12.0.2; +386/+143/+93 B; prior reserves kept.
  'client.cjs': { raw: 166_476, gzip: 52_128, brotli: 45_080 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 128 653 → 128 687 (+34 B, measured 128 632 → 128 666); brotli 35 116 → 35 236 (measured 35 116, 0 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 128 687 → 128 736 (+49 B, measured 128 666 → 128 715); gzip 40 630 → 40 644 (+14 B, measured 40 621 → 40 635).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 128 736 → 128 869 (+133 B, measured 128 715 → 128 848); gzip 40 644 → 40 684 (+40 B, measured 40 635 → 40 675).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 128 869 → 129 324 (+455 B, measured 128 848 → 129 303); gzip 40 684 → 40 796 (+112 B, measured 40 676 → 40 788); brotli 35 236 → 35 326 (measured 35 170 → 35 260, cushion kept).
  // 2026-09-27 (PHD-05): measured +178/+67/+79 B; same 21/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +2070/+594/+451 B; same 21/12/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +585/+155/+194 B; same 21/12/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+13/-9 B; same 21/12/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +73/+35/+33 B; same 21/12/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2992/+906/+757 B; same 21/12/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3310/+1081/+857 B; same 21/12/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +81/+59/+56 B; same 21/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -163/-27/-25 B; same 21/12/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +33/+8/+8 B; same 21/12/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +438/+159/+140 B; same 21/12/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +381/+146/+55 B; same 21/12/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +618/+245/+257 B; same 21/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7695/+2482/+2155 B; cushions 21/12/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8156/+2613/+2317 B raw/gzip/Brotli; reserves 21/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +317/+27/+56 B raw/gzip/Brotli; reserves 21/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +22/+11/+35 B raw/gzip/Brotli;
  // retain the prior 21/12/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +379/+133/+145 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +211/+73/+46 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +656/+188/+196 B; prior reserves kept.
  // 2026-10-26 (the 2.2 review fixes): paired Node24.22.1/npm12.0.2; +75/+17/-16 B; a component that fell is left where it was; prior reserves kept.
  // 2026-10-28 (format and locale reach the binding): paired Node24.22.1/npm12.0.2, epoch1793120979; +46/+18/+12 B; prior reserves kept.
  // 2026-10-28 (the renderers write what the element expects): paired Node24.22.1/npm12.0.2, epoch1793120979; +1251/+444/+431 B; prior reserves kept.
  // 2026-10-28 (fidelity escalates again on a new value): paired Node24.22.1/npm12.0.2, epoch1793120979; +735/+239/+99 B; prior reserves kept.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +920/+284/+305 B; prior reserves kept.
  // 2026-10-29 (the handshake and the gate respect the page): paired Node24.22.1/npm12.0.2; +462/+159/+115 B; prior reserves kept.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +199/+44/+91 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+40/-15 B; prior reserves kept. The Brotli ceiling stays where it was: it fell.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/+0/+28 B; prior reserves kept.
  // 2026-10-31 (an opt-in deadline for the merge): paired Node24.22.1/npm12.0.2; +386/+140/+118 B; prior reserves kept.
  'client.js': { raw: 166_395, gzip: 52_114, brotli: 45_128 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 018 → 7 028 (+10 B, measured 7 010 → 7 020); brotli 6 322 → 6 425 (measured 6 305, 17 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 20 003 → 20 136 (+133 B, measured 19 916 → 20 049); gzip 7 028 → 7 069 (+41 B, measured 7 020 → 7 061).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 20 136 → 20 368 (+232 B, measured 20 049 → 20 281); gzip 7 069 → 7 122 (+53 B, measured 7 061 → 7 114).
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1110/+350/+307 B; same 87/12/87 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +10/+9/+17 B; same 87/12/87 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +624/+255/+245 B; same 87/12/87 B cushions.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +200/+57/+54 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+29/+23 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/+4/+5 B; prior reserves kept.
  'structural.cjs': { raw: 22_709, gzip: 7_944, brotli: 7_224 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 7 019 → 7 029 (+10 B, measured 7 014 → 7 024); brotli 6 326 → 6 427 (measured 6 307, 19 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 19 958 → 20 091 (+133 B, measured 19 870 → 20 003); gzip 7 029 → 7 068 (+39 B, measured 7 024 → 7 063).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 20 091 → 20 323 (+232 B, measured 20 003 → 20 235); gzip 7 068 → 7 120 (+52 B, measured 7 063 → 7 115).
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1100/+347/+308 B; same 88/12/90 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +10/+7/+19 B; same 88/12/90 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +625/+261/+236 B; same 88/12/90 B cushions.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +199/+56/+56 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+28/+19 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/+4/+4 B; prior reserves kept.
  'structural.js': { raw: 22_664, gzip: 7_947, brotli: 7_236 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 768 → 91 802 (+34 B, measured 91 749 → 91 783).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 802 → 91 851 (+49 B, measured 91 783 → 91 832); gzip 29 177 → 29 190 (+13 B, measured 29 171 → 29 184).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 851 → 91 869 (+18 B, measured 91 832 → 91 850); gzip 29 190 → 29 197 (+7 B, measured 29 184 → 29 191).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 91 869 → 92 310 (+441 B, measured 91 850 → 92 291); gzip 29 197 → 29 316 (+119 B, measured 29 193 → 29 312); brotli 25 916 → 26 068 (measured 25 854 → 26 006, cushion kept).
  // 2026-09-27 (PHD-05): measured +167/+107/+79 B; same 9/6/133 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+10/-42 B; same 9/6/133 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +193/+56/+72 B; same 9/6/133 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured -24/-10/-36 B; same 9/6/133 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2914/+888/+726 B; same 9/6/133 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +2514/+855/+771 B; same 9/6/133 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+46/+22 B; same 9/6/133 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -148/-21/-32 B; same 9/6/133 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+138/+156 B; same 9/6/133 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+294/+214 B; same 9/6/133 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7528/+2447/+2169 B; cushions 9/6/133 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8002/+2581/+2341 B raw/gzip/Brotli; reserves 9/6/133 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +315/+40/-35 B raw/gzip/Brotli; reserves 9/6/133 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +22/+5/+77 B raw/gzip/Brotli;
  // retain the prior 9/6/133 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +159/+37/+24 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +615/+201/+166 B; prior reserves kept.
  // 2026-10-26 (the 2.2 review fixes): paired Node24.22.1/npm12.0.2; +31/+12/+4 B; prior reserves kept.
  // 2026-10-28 (format and locale reach the binding): paired Node24.22.1/npm12.0.2, epoch1793120979; +34/+36/+47 B; prior reserves kept.
  // 2026-10-28 (the renderers write what the element expects): paired Node24.22.1/npm12.0.2, epoch1793120979; +1194/+388/+365 B; prior reserves kept.
  // 2026-10-28 (fidelity escalates again on a new value): paired Node24.22.1/npm12.0.2, epoch1793120979; +704/+258/+222 B; prior reserves kept.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +476/+153/+114 B; prior reserves kept.
  // 2026-10-29 (the handshake and the gate respect the page): paired Node24.22.1/npm12.0.2; +408/+138/+160 B; prior reserves kept.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +193/+59/+29 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +74/+28/+30 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/-3/+5 B; the gzip ceiling stays, it fell; prior reserves kept.
  // 2026-10-30 (2.2.2 Version PR): gzip 38 673 → 38 678 (+5 B). The version string 2.2.1 → 2.2.2 keeps its length and still moved gzip: CI (Node 22.23.2) measured 38 669 at 83f66e9 and 38 674 on the Version PR, and Node 22.23.2 locally gave the same bytes; the 4 B reserve is kept.
  // 2026-10-31 (an opt-in deadline for the merge): paired Node24.22.1/npm12.0.2; +385/+157/+115 B; prior reserves kept.
  'lean.cjs': { raw: 122_770, gzip: 38_835, brotli: 34_361 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 757 → 91 791 (+34 B, measured 91 738 → 91 772).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 791 → 91 840 (+49 B, measured 91 772 → 91 821); gzip 29 171 → 29 183 (+12 B, measured 29 167 → 29 179).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 91 840 → 91 858 (+18 B, measured 91 821 → 91 839); gzip 29 183 → 29 190 (+7 B, measured 29 179 → 29 186).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 91 858 → 92 299 (+441 B, measured 91 839 → 92 280); gzip 29 190 → 29 309 (+119 B, measured 29 188 → 29 307); brotli 25 929 → 26 079 (measured 25 834 → 25 984, cushion kept).
  // 2026-09-27 (PHD-05): measured +167/+108/+57 B; same 9/6/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+10/-1 B; same 9/6/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +193/+54/+47 B; same 9/6/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured -24/-9/+53 B; same 9/6/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2914/+888/+692 B; same 9/6/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +2514/+855/+771 B; same 9/6/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+46/-5 B; same 9/6/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -148/-22/+28 B; same 9/6/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+139/+96 B; same 9/6/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+294/+225 B; same 9/6/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7528/+2446/+2150 B; cushions 9/6/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8002/+2581/+2240 B raw/gzip/Brotli; reserves 9/6/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +315/+41/+15 B raw/gzip/Brotli; reserves 9/6/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +22/+6/-39 B raw/gzip/Brotli;
  // retain the prior 9/6/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +159/+38/+115 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +615/+200/+136 B; prior reserves kept.
  // 2026-10-26 (the 2.2 review fixes): paired Node24.22.1/npm12.0.2; +31/+11/-9 B; a component that fell is left where it was; prior reserves kept.
  // 2026-10-28 (format and locale reach the binding): paired Node24.22.1/npm12.0.2, epoch1793120979; +34/+35/+30 B; prior reserves kept.
  // 2026-10-28 (the renderers write what the element expects): paired Node24.22.1/npm12.0.2, epoch1793120979; +1194/+389/+427 B; prior reserves kept.
  // 2026-10-28 (fidelity escalates again on a new value): paired Node24.22.1/npm12.0.2, epoch1793120979; +704/+259/+130 B; prior reserves kept.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +476/+152/+144 B; prior reserves kept.
  // 2026-10-29 (the handshake and the gate respect the page): paired Node24.22.1/npm12.0.2; +408/+138/+94 B; prior reserves kept.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +193/+60/+101 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +74/+28/+28 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/-3/-4 B; the gzip and Brotli ceilings stay, they fell; prior reserves kept.
  // 2026-10-30 (2.2.2 Version PR): gzip 38 666 → 38 671 (+5 B). The version string 2.2.1 → 2.2.2 keeps its length and still moved gzip: CI (Node 22.23.2) measured 38 662 at 83f66e9 and 38 667 on the Version PR, and Node 22.23.2 locally gave the same bytes; the 4 B reserve is kept.
  // 2026-10-31 (an opt-in deadline for the merge): paired Node24.22.1/npm12.0.2; +385/+157/+120 B; prior reserves kept.
  'lean.js': { raw: 122_759, gzip: 38_828, brotli: 34_326 },
  // 2026-09-16 (2.0.1 Version PR): gzip 5 602 → 5 612. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 5 600 against a cushion of 2 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 307 → 16 527 (+220 B, measured 16 305 → 16 525); gzip 5 612 → 5 665 (+53 B, measured 5 600 → 5 653); brotli 5 072 → 5 162 (measured 5 072; under the 2 % notice).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 16 527 → 16 755 (+228 B, measured 16 525 → 16 753); gzip 5 665 → 5 720 (+55 B, measured 5 653 → 5 708).
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +81/+45/+42 B; same 2/12/97 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +495/+189/+166 B; same 2/12/97 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +328/+143/+135 B; same 2/12/97 B cushions.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +198/+65/+61 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+32/+30 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/+1/+1 B; prior reserves kept.
  'lexical.cjs': { raw: 18_637, gzip: 6_389, brotli: 5_838 },
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 16 278 → 16 490 (+212 B, measured 16 276 → 16 488); gzip 5 606 → 5 658 (+52 B, measured 5 602 → 5 654); brotli 5 079 → 5 165 (measured 5 075; under the 2 % notice).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 16 490 → 16 718 (+228 B, measured 16 488 → 16 716); gzip 5 658 → 5 715 (+57 B, measured 5 654 → 5 711).
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +81/+45/+44 B; same 2/12/97 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +495/+173/+161 B; same 2/12/97 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +326/+153/+139 B; same 2/12/97 B cushions.
  // 2026-10-29 (2.2.1, the sanitizer writes the nodes it cleaned): paired Node24.22.1/npm12.0.2; +198/+65/+55 B; prior reserves kept.
  // 2026-10-30 (the sanitizer checks every URL it admits): paired Node24.22.1/npm12.0.2; +84/+33/+32 B; prior reserves kept.
  // 2026-10-30 (a ping keeps its safe targets around any whitespace): paired Node24.22.1/npm12.0.2; +1/+1/+1 B; prior reserves kept.
  'lexical.js': { raw: 18_598, gzip: 6_392, brotli: 5_833 },
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
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -32/+3/-15 B; same 86/37/61 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2605/+920/+856 B; same 86/37/61 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +33/+11/-9 B; same 86/37/61 B cushions.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +404/+129/+108 B; prior reserves kept.
  'plugins.cjs': { raw: 22_388, gzip: 8_198, brotli: 7_232 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +32/+12/+1 B; same 86/33/92 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -32/+0/+9 B; same 86/33/92 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +2605/+921/+832 B; same 86/33/92 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +33/+11/+10 B; same 86/33/92 B cushions.
  // 2026-10-29 (the route renders only for real changes): paired Node24.22.1/npm12.0.2; +404/+136/+112 B; prior reserves kept.
  'plugins.js': { raw: 22_364, gzip: 8_187, brotli: 7_260 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1311/+423/+399 B; same 20/3/84 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +22/+13/-6 B; same 20/3/84 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+0/+2 B; same 20/3/84 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +206/+86/+80 B; same 20/3/84 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +130/+41/+37 B; cushions 20/3/120 B.
  // Brotli keeps 120 B against epoch variance; the paired predecessor left less than that.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +133/+49/+43 B raw/gzip/Brotli;
  // retain the prior 20/3/120 B reserves.
  'fragment.cjs': { raw: 16_997, gzip: 6_485, brotli: 5_834 },
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +1311/+429/+364 B; same 20/9/79 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +22/+16/+17 B; same 20/9/79 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured -4/-2/-1 B; same 20/9/79 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+1/+11 B; same 20/9/79 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +206/+86/+80 B; same 20/9/79 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +130/+53/+35 B; cushions 20/9/120 B.
  // Brotli keeps 120 B against epoch variance; the paired predecessor left less than that.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +133/+47/+68 B raw/gzip/Brotli;
  // retain the prior 20/9/120 B reserves.
  'fragment.js': { raw: 16_927, gzip: 6_467, brotli: 5_830 },
};
