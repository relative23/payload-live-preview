/**
 * The byte budgets of the framework adapter entries and the log of why each
 * number is what it is. Every adapter bundle embeds the runtime, so these rows
 * move with it. Split from `entry-budgets.ts` when that log passed the 600-line
 * limit (2026-09-29, PHD-02); what these rows did before is recorded here too.
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

export const ADAPTER_ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // 2026-09-12 (C2, LP0801 reaches the log): +30 B raw wherever the runtime sits — this row and INLINE_BUDGET raw go to the measurement, `core.js` brotli to measurement plus the documented cushion.
  // 2026-09-14 (2.0.1, guesses in a fragment boundary): gzip 50 878 → 50 888, the fix's
  // +10 B (measured 50 870 → 50 880); cushion kept.
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): gzip 50 888 → 50 901 (+13 B, measured 50 880 → 50 893); brotli 43 515 → 43 631 (measured 43 511, 4 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 161 256 → 161 305 (+49 B, measured 161 217 → 161 266); gzip 50 901 → 50 911 (+10 B, measured 50 893 → 50 903).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 50 911 → 50 918 (+7 B, measured 50 903 → 50 910).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 161 305 → 161 756 (+451 B, measured 161 284 → 161 735); gzip 50 918 → 51 037 (+119 B, measured 50 909 → 51 028); brotli 43 631 → 43 731 (measured 43 541 → 43 641, cushion kept).
  // 2026-09-27 (PHD-04, per-render Astro props bridge): measured against the
  // retained archive: 180553/56660/48315 -> 180710/56719/48331 B.
  // Add exactly +157/+59/+16 B; preserve the 21/12/120 B cushions.
  // 2026-09-27 (PHD-05): runtime island handoff/deduplication, measured
  // +167/+97/+115 B; unchanged 21/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +7315/+1749/+1411 B; same 21/12/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +569/+150/+242 B; same 106/27/167 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+6/-52 B; same 106/27/167 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +119/-25/-8 B; same 106/27/167 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +3015/+915/+788 B; same 106/27/167 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3164/+1052/+837 B; same 106/27/167 B cushions.
  // 2026-09-29 (H12, authorization by module reference, ADR 0024): measured +951/+288/+259 B; same 106/27/167 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+43/+63 B; same 106/27/167 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -149/-12/-85 B; same 106/27/167 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +1030/+400/+343 B; same 106/27/167 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+1/+35 B; same 106/27/167 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +358/+311/+132 B; same 106/27/167 B cushions.
  // 2026-10-01 (H17, a fragment's components and its request context are the page's, ADR 0029): measured +23/+11/+33 B; same 106/27/167 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+197/+146 B; same 106/27/167 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +360/+7/+38 B; same 106/27/167 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+203/+124 B; same 106/27/167 B cushions.
  // 2026-10-02 (PHD-25, a bounded session-origin retry preserves Payload 2 cookies, ADR 0006): measured +209/+109/+108 B; same 106/27/167 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7858/+2580/+2082 B; cushions 106/27/167 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8332/+2713/+2220 B raw/gzip/Brotli; reserves 106/27/167 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +314/+24/-8 B raw/gzip/Brotli; reserves 106/27/167 B.
  // 2026-10-05 (2.1.0): skip fully static island table writes while retaining on-demand routes.
  // Paired Node24.19/npm12.0.2, epoch1791096072; measured +46/+25/+10 B raw/gzip/Brotli; reserves 106/27/167 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +153/+100/+98 B raw/gzip/Brotli;
  // retain the prior 106/27/167 B reserves.
  // 2026-10-17: inline and loader delivery refuse authorizePreview and shouldInject with a message that
  // names where each can run. Node24.19/npm12.0.2: measured 208 900 / 65 334 / 55 343 B raw/gzip/Brotli;
  // the same 106/27/167 B reserves. 2026-10-17 (media URLs resolve against `serverURL`): +331/+69/+76 B on top.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +368/+138/+133 B; prior reserves kept.
  // 2026-10-26 (the adapters forward the visibility gate, and the doctor reads it): paired Node24.22.1/npm12.0.2; +180/+37/+24 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +209/+76/+43 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +612/+221/+171 B; prior reserves kept.
  'adapters/astro/index.js': { raw: 211_003, gzip: 65_967, brotli: 56_021 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): brotli 39 900 → 40 030 (measured 39 910, -10 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 147 776 → 147 825 (+49 B, measured 147 742 → 147 791); gzip 46 671 → 46 681 (+10 B, measured 46 665 → 46 675).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 46 681 → 46 688 (+7 B, measured 46 675 → 46 682).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 147 825 → 148 276 (+451 B, measured 147 809 → 148 260); gzip 46 688 → 46 808 (+120 B, measured 46 682 → 46 802).
  // 2026-09-27 (PHD-05): measured +167/+98/+62 B; same 16/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +4601/+848/+544 B; same 16/12/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +569/+154/+232 B; same 16/12/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+1/-79 B; same 16/12/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +119/-24/-6 B; same 16/12/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +3015/+906/+742 B; same 16/12/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3164/+1049/+895 B; same 16/12/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+39/+43 B; same 16/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -149/-14/+24 B; same 16/12/120 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +672/+206/+104 B; same 16/12/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +358/+326/+285 B; same 16/12/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+212/+54 B; same 16/12/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +360/+0/+66 B; same 16/12/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+200/+95 B; same 16/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7529/+2477/+2123 B; cushions 16/12/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8003/+2608/+2242 B raw/gzip/Brotli; reserves 16/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +314/+45/+26 B raw/gzip/Brotli; reserves 16/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +153/+104/+160 B raw/gzip/Brotli;
  // retain the prior 16/12/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +368/+146/+129 B; prior reserves kept.
  // 2026-10-26 (the adapters forward the visibility gate, and the doctor reads it): paired Node24.22.1/npm12.0.2; +180/+27/+84 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +209/+78/+39 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +612/+223/+80 B; prior reserves kept.
  'adapters/astro/middleware-entry.js': { raw: 186_312, gzip: 58_229, brotli: 49_479 },
  //
  // 2026-09-07 (Z8, an async server component for Next): one row moves, and only
  // this one. `adapters/nextjs/index.js` rises +177 B raw / +43 B gzip for
  // `<LivePreviewScript />` — the policy call, the decision branch and the
  // element it builds. Nothing else in the package sees it: `react` is reached
  // through a lazy dynamic import, so no entry gains a static dependency, and
  // `check-tree-shaking.ts` still measures 43 990 gzip for a project that
  // imports only `createLivePreviewMiddleware`. The brotli row rises with them
  // even though it did not cross: it sat 21 B under its ceiling after Z19
  // trimmed it, and this file has already said once that 21 B is a coin flip
  // rather than a budget on the one measurement CI's Node can disagree about.
  // Back to the documented ~120 B.
  //
  // The bytes buy the only delivery in this package that can decline to render.
  // A root layout renders for every visitor and the two synchronous helpers
  // cannot wait for a verdict, so LP-8 measured 195 342 of 254 707 bytes of
  // runtime on a request with no cookie; an async component awaits
  // `authorizePreview` and renders nothing for it.
  //
  // 2026-09-14 (2.0.0): the release version is four characters shorter than
  // `2.0.0-rc.1`, and this adapter carries it once. Measured on this host from
  // the same source, only the version line differing: raw 159 588 → 159 583
  // (-5), gzip 50 297 → 50 293 (-4), brotli 43 074 → 43 199 (**+125**). A
  // shorter input compressing worse is the substitution effect this file
  // already records two notes above; it is why every brotli row keeps a
  // cushion. Here the shift is 5 B larger than that cushion, so the row goes to
  // the 2.0.0 measurement plus the documented ~120 B. raw and gzip keep their
  // numbers: both fell and both stay inside their ceilings.
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 159 664 → 159 713 (+49 B, measured 159 663 → 159 712).
  // 2026-09-16 (2.0.1 Version PR): gzip 50 454 → 50 467. The version string changes with every release and gzip is not byte-stable across Node majors; CI (Node 22  "2.0.1") measured 50 455 against a cushion of -1 B. Twelve bytes over that measurement  as the rows that never flipped carry.
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): raw 159 713 → 159 731 (+18 B, measured 159 712 → 159 730); gzip 50 467 → 50 473 (+6 B, measured 50 454 → 50 460).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 159 731 → 160 182 (+451 B, measured 159 730 → 160 181); gzip 50 473 → 50 594 (+121 B, measured 50 457 → 50 578).
  // 2026-09-27 (PHD-05): measured +167/+107/+94 B; same 20/16/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +4601/+847/+599 B; same 20/16/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +569/+157/+161 B; same 20/16/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+3/-40 B; same 20/16/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +119/-18/-83 B; same 20/16/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +3015/+907/+807 B; same 20/16/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3164/+1051/+918 B; same 20/16/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+42/+38 B; same 20/16/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -149/-17/-12 B; same 20/16/120 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +850/+301/+230 B; same 20/16/120 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+0/+50 B; same 20/16/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +358/+319/+171 B; same 20/16/120 B cushions.
  // 2026-10-01 (H17, a fragment's components and its request context are the page's, ADR 0029): measured +12/-3/-130 B; same 20/16/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+211/+249 B; same 20/16/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +360/+16/-44 B; same 20/16/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+203/+191 B; same 20/16/120 B cushions.
  // 2026-10-02 (PHD-25, a bounded session-origin retry preserves Payload 2 cookies, ADR 0006): measured +211/+90/+103 B; same 20/16/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7840/+2578/+2123 B; cushions 20/16/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8314/+2712/+2281 B raw/gzip/Brotli; reserves 20/16/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +314/+31/+66 B raw/gzip/Brotli; reserves 20/16/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +153/+95/+82 B raw/gzip/Brotli;
  // retain the prior 34/22/160 B reserves.
  // 2026-10-24 (2.1.1): the middleware keeps `frame-ancestors` under `manageCsp: 'full'`
  // when no injected script can carry the nonce, and warns once in development.
  // Node24.22.1/npm12.0.2, same tree with and without the change: +476/+221/+209 B
  // raw/gzip/Brotli; retain the reserves it had, 28/13/142 B.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +368/+144/+126 B; prior reserves kept.
  // 2026-10-26 (the adapters forward the visibility gate, and the doctor reads it): paired Node24.22.1/npm12.0.2; +180/+28/+46 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +209/+77/+5 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +612/+219/+116 B; prior reserves kept.
  'adapters/nextjs/index.js': { raw: 205_028, gzip: 64_207, brotli: 54_461 },
  //
  // 2026-09-06 (`./react`, `./vue`): two new rows, measured at 14 045 / 13 814
  // raw and 4 637 / 4 621 gzip. Both entries carry the message bus, the origin
  // detector and the merger — the document half of the runtime — and nothing
  // that touches an element, which is why each is a third of an adapter row.
  // They share every module but their reactivity, hence the near-identical
  // figures.
  // 2026-09-24 (H20, hook session identity): raw 13 992 → 14 024
  // (measured 14 008); the row keeps its 16 B raw cushion. Its measured gzip
  // 4 758 and brotli 4 303 remain below their existing ceilings.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +47/+14/+4 B; same 16/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -165/-25/-28 B; same 16/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7766/+2529/+2345 B; cushions 16/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +189/-1/-3 B raw/gzip/Brotli; reserves 16/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +21/+10/+13 B raw/gzip/Brotli;
  // retain the prior 16/12/120 B reserves.
  'adapters/react/index.js': { raw: 23_227, gzip: 7_618, brotli: 7_047 },
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +80/+22/+22 B; same 16/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -165/-26/-29 B; same 16/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7766/+2534/+2343 B; cushions 16/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +189/-1/+1 B raw/gzip/Brotli; reserves 16/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +21/+10/+13 B raw/gzip/Brotli;
  // retain the prior 16/12/120 B reserves.
  'adapters/vue/index.js': { raw: 22_477, gzip: 7_422, brotli: 6_866 },
  //
  // 2026-09-06 (R4, zero-config setup): one new row. `adapters/nuxt/module.js`
  // is the build-time Nuxt module — a few hundred bytes, because all it does is
  // write a plugin into `.nuxt/` and register its path; the runtime it pulls in
  // is the existing `./nuxt` entry, which the generated plugin imports. The Next
  // row rises ~700 B gzip for `withLivePreview()`: the header rules and the
  // frame-ancestors builder it shares with the middleware.
  // 2026-09-29 (H12, authorization by module reference, ADR 0024): measured +1448/+485/+428 B; same 11/7/6 B cushions.
  // 2026-10-02 (H18 and PHD-17, a Nuxt fragment is a standalone Vue app, ADR 0030): measured +421/+200/+178 B; same 11/7/6 B cushions.
  // 2026-10-02 (real admin, `nuxt dev` could not load a reference without an extension; the module names the file it finds): measured +570/+235/+223 B; same 11/7/6 B cushions.
  // 2026-10-04 (2.1.0: Nuxt no-reference compatibility and absolute-root reference guard):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +263/+97/+82 B raw/gzip/Brotli; reserves 11/7/120 B.
  // Raw/gzip reserves unchanged; Brotli reserve 6 -> 120 B meets the recorded minimum.
  'adapters/nuxt/module.js': { raw: 3_362, gzip: 1_443, brotli: 1_374 },
  // 2026-09-12 (C1): sveltekit brotli 42 479 → 42 620, the only metric the drawer-edit fix crossed (measured 42 500 + the ~120 B cushion).
  // 2026-09-14 (2.0.1): brotli 42 955 → 43 092. Its cushion was 4 B (measured 42 951), which
  // brotli's run-to-run swing crosses with no code change; the fix's build measured 42 972 and
  // the row now carries the ~120 B the other brotli rows keep.
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 158 976 → 159 025 (+49 B, measured 158 943 → 158 992).
  // 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 50 291 → 50 296 (+5 B, measured 50 279 → 50 284).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 159 025 → 159 476 (+451 B, measured 159 010 → 159 461); gzip 50 296 → 50 407 (+111 B, measured 50 285 → 50 396); brotli 43 092 → 43 290 (measured 42 930 → 43 128, cushion kept).
  // 2026-09-27 (PHD-05): measured +167/+98/+57 B; same 15/12/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +4601/+833/+620 B; same 15/12/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +569/+158/+128 B; same 15/12/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+3/-12 B; same 15/12/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +119/-18/+41 B; same 15/12/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +3015/+914/+698 B; same 15/12/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3164/+1065/+977 B; same 15/12/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+40/-35 B; same 15/12/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -149/-27/-34 B; same 15/12/120 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +850/+312/+308 B; same 15/12/120 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+0/+7 B; same 15/12/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +358/+313/+149 B; same 15/12/120 B cushions.
  // 2026-10-01 (H17, a fragment's components and its request context are the page's, ADR 0029): measured +29/+3/-17 B; same 15/12/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +426/+203/+182 B; same 15/12/120 B cushions.
  // 2026-10-02 (H18 and PHD-17, a Nuxt fragment is a standalone Vue app, ADR 0030): measured +87/+37/-62 B; same 15/12/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +360/+13/+97 B; same 15/12/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+210/+175 B; same 15/12/120 B cushions.
  // 2026-10-02 (PHD-25, a bounded session-origin retry preserves Payload 2 cookies, ADR 0006): measured +209/+106/+97 B; same 15/12/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7858/+2582/+2085 B; cushions 15/12/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8332/+2718/+2251 B raw/gzip/Brotli; reserves 15/12/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +314/+36/-13 B raw/gzip/Brotli; reserves 15/12/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +153/+99/+147 B raw/gzip/Brotli;
  // retain the prior 15/12/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +368/+149/+156 B; prior reserves kept.
  // 2026-10-26 (the adapters forward the visibility gate, and the doctor reads it): paired Node24.22.1/npm12.0.2; +180/+33/+44 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +209/+76/+4 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +612/+222/+118 B; prior reserves kept.
  'adapters/nuxt/index.js': { raw: 205_299, gzip: 64_312, brotli: 54_447 },
  // 2026-09-14 (2.0.1, three diagnostics that said what did not happen): brotli 42 740 → 42 835 (measured 42 715, 25 B left, inside brotli's run-to-run swing; ~120 B as the other brotli rows).
  // 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 157 966 → 158 015 (+49 B, measured 157 932 → 157 981).
  // 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 158 015 → 158 466 (+451 B, measured 157 999 → 158 450); gzip 49 998 → 50 123 (+125 B, measured 49 983 → 50 108).
  // 2026-09-27 (PHD-05): measured +167/+106/+122 B; same 16/15/120 B cushions.
  // 2026-09-28 (H05 fragment islands, ADR 0021): measured +4601/+863/+543 B; same 16/15/120 B cushions.
  // 2026-09-28 (PHD-07, strategy work a newer revision supersedes or outlives): measured +569/+153/+166 B; same 16/15/120 B cushions.
  // 2026-09-28 (PHD-03, styles through the CSSOM under a strict style-src): measured -8/+3/-52 B; same 16/15/120 B cushions.
  // 2026-09-29 (PHD-02, owner-scoped route planning): measured +119/-20/+47 B; same 16/15/120 B cushions.
  // 2026-09-29 (H02, sub-field coverage declared, ADR 0022): measured +3015/+917/+710 B; same 16/15/120 B cushions.
  // 2026-09-29 (H13, revision display state, ADR 0023): measured +3164/+1043/+928 B; same 16/15/120 B cushions.
  // 2026-09-29 (H10, lexical render can require a document, ADR 0025): measured +71/+40/+63 B; same 16/15/120 B cushions.
  // 2026-09-29 (PHD-11, the bus's replay drops two unreachable guards): measured -149/-20/-78 B; same 16/15/120 B cushions.
  // 2026-09-29 (O-35, deprecations warn before 3.0, ADR 0026): measured +849/+304/+278 B; same 16/15/120 B cushions.
  // 2026-09-29 (H07, fragment requests within measured bounds, ADR 0027): measured +0/+1/+23 B; same 16/15/120 B cushions.
  // 2026-09-29 (H15, a host route refresh settles after the host commits, ADR 0028): measured +358/+320/+175 B; same 16/15/120 B cushions.
  // 2026-10-01 (H17, a fragment's components and its request context are the page's, ADR 0029): measured +29/+8/-59 B; same 16/15/120 B cushions.
  // 2026-10-01 (PHD-13, the first write waits for SvelteKit's root to mount, ADR 0015): measured +448/+219/+243 B; same 16/15/120 B cushions.
  // 2026-10-02 (H06, a fragment render lands in the boundary that replaced its own): measured +360/+12/-28 B; same 16/15/120 B cushions.
  // 2026-10-02 (PHD-19, the sanitizer settles on a fixed point and reads a scheme through whitespace, ADR 0016): measured +623/+203/+135 B; same 16/15/120 B cushions.
  // 2026-10-02 (PHD-25, a bounded session-origin retry preserves Payload 2 cookies, ADR 0006): measured +209/+98/+135 B; same 16/15/120 B cushions.
  // 2026-10-04 (combined 2.1: bounded v2 population, locale cache and depth/React integration): paired Node24.19/npm12.0.2, epoch1790957103; measured +7857/+2575/+2114 B; cushions 16/15/120 B.
  // 2026-10-04 (2.1.0: bounded v2/locale/depth/React integration and owner/scheduler fixes):
  // Paired Node24.19/npm12.0.2, epoch1791096072; +8331/+2710/+2318 B raw/gzip/Brotli; reserves 16/15/120 B.
  // 2026-10-04 (2.1.0): merger reentrancy and accepted-locale/consumer recovery.
  // Node24.19/npm12.0.2, epoch1791096072; previous sample +314/+32/-21 B raw/gzip/Brotli; reserves 16/15/120 B.
  // 2026-10-08: measured 2.1.0 after fixes for empty v2 fields and fragment response ownership.
  // Node24.19/npm12.0.2, epoch1791096072: +153/+97/+105 B raw/gzip/Brotli;
  // retain the prior 16/15/120 B reserves.
  // 2026-10-25 (a saved-only route render runs again on Payload's save): paired Node24.22.1/npm12.0.2; +368/+149/+64 B; prior reserves kept.
  // 2026-10-26 (the adapters forward the visibility gate, and the doctor reads it): paired Node24.22.1/npm12.0.2; +180/+26/+17 B; prior reserves kept.
  // 2026-10-26 (LP0808 names the missing boundary): paired Node24.22.1/npm12.0.2; +209/+74/+51 B; prior reserves kept.
  // 2026-10-26 (the merge decision reads rich text by its shape): paired Node24.22.1/npm12.0.2; +612/+216/+222 B; prior reserves kept.
  'adapters/sveltekit/index.js': { raw: 204_376, gzip: 63_993, brotli: 54_347 },
};
