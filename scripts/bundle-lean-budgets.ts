/**
 * The byte budgets of the inline script built with `profile: 'lean'`, and the
 * log of why each number is what it is. Split out of `bundle-budgets.ts` on
 * 2026-09-12, when that log reached the 500-line limit for the third time; the
 * default profile and its reasons stay there, and every "the same … as the full
 * profile" below refers to the runtime's own change recorded in `INLINE_BUDGET`.
 */
/**
 * The same script with `profile: 'lean'`: the strategy runner, the keyed morph,
 * the structural applier, the array renderers with their item templates and the
 * screen-reader announcer are not in the artifact at all, and the runtime
 * reports LP0104 when a page needs one of them.
 *
 * 24 763 gzip against the full script's 30 253 — 5 490 bytes, 18 %. The plan
 * that asked for this profile hoped for under 15 000; that is not reachable by
 * leaving features out, because what remains is the machine itself: the message
 * bus, the scheduler, the binding cache, the update pipeline, the merger and
 * the sanitizer are ~19 000 gzip together. Measured in Ü9 of the private
 * roadmap, including the alternative (feature preludes) and why it is worse:
 * a prelude repeats the sanitizer and the schema diff, so a page that uses the
 * feature ends up larger than it is today.
 */
// Raised 2026-09-07 (LP-1): raw 81 098 → 81 330 (measured 81 206), gzip 25 359 →
// 25 430 (measured 25 386), brotli 22 557 → 22 660 (measured 22 530). The lean
// profile leaves out the strategy runner, the morph and the structural applier —
// it does not leave out the update pipeline, and the level-versus-edge decision
// lives there. A lean page pays the same 431 B as a full one and gets the same
// thing back: `skipUnchanged` still works after the editor saves.
// Raised 2026-09-07 (LP-2): raw 81 330 → 81 920 (measured 81 849), gzip 25 430 →
// 25 650 (measured 25 620), brotli 22 660 → 22 850 (measured 22 735). The lean
// profile leaves out the morph and the structural applier; it does not leave out
// the rich-text renderer, and that is where a block's server markup is kept.
// Raised 2026-09-07 (Z3): raw 81 920 → 82 830 (measured 82 738), gzip 25 650 →
// 25 990 (measured 25 951), brotli 22 850 → 23 120 (measured 23 000). The lean
// profile carries the verdict and the reporting and leaves out the escalation:
// it has no strategy runner, so `escalateUnfaithful` there is a function that
// returns. That is the 396 B between +1 303 and +907, and it is why a lean page
// gets LP0411 in its log and no refresh.
// Raised 2026-09-07 (Z4): raw 82 830 → 85 540 (measured 85 454), gzip 25 990 →
// 26 820 (measured 26 775), brotli 23 120 → 23 850 (measured 23 721). The lean
// profile pays the same 2 716 B as the full one and gets the same thing back:
// the merge is not one of the features it leaves out, so neither is the decision
// about whether to make it.
// Raised 2026-09-07 (Z5): raw 85 540 → 85 720 (measured 85 626). The scheduler
// is the machine itself, not a feature, so the lean profile pays the same 172 B
// and a lean page's keystroke lands in the same frame. gzip and brotli hold.
// Raised 2026-09-07 (Z6): raw 85 720 → 85 830 (measured 85 740), gzip 26 820 →
// 26 880 (measured 26 850). Brotli holds. The lean profile has no route strategy
// to refuse anything, and pays 20 B all the same: the cancelled timer lives in
// the runtime state every profile carries, and paying for the slot is cheaper
// than a second shape of that object.
// Raised 2026-09-07 (Z7): raw 85_830 → 86_100 (measured 85_984), gzip 26_880 →
// 26_970 (measured 26_924), brotli 23_850 → 23_990 (measured 23_864). The lean
// profile pays the same 244 B as the full one: the update pipeline is the
// machine itself, and LP0201 sits in it.
// Holds 2026-09-07 (Z22): raw 86_009, gzip 26_932, brotli 23_880, all three
// still under. The lean profile leaves out the array renderers and the
// structural applier, so the only thing it pays for is the 25 B of shared
// attribute rule — and a lean page never rebuilds a list to begin with.
// Raised 2026-09-10 (Z9): raw 86_920 → 87_386 (measured 87_276), gzip 27_260 →
// 27_502 (27_452), brotli 24_230 → 24_417 (24_287); the search is not in it.
// Raised 2026-09-10 (Z26): raw 87_386 → 87_501 (measured 87_391), gzip 27_502
// → 27_533 (27_483), brotli 24_417 → 24_455 (24_325). The lean profile has no
// route strategy and never restores a guess; the 115 B are the slot in the
// runtime state and the pipeline's folded method — the search stays out.
// Lowered 2026-09-11 (Z28): raw 87_501 → 86_684 (measured 86_574), gzip 27_533 → 27_371
// (27_321), brotli 24_455 → 24_348 (24_218) — the same −817 B: every line that went
// is in a module the lean profile carries too (see INLINE_BUDGET).
// Raised 2026-09-11 (Z30): raw 86_684 → 87_374 (measured 87_264), gzip 27_371 → 27_544
// (27_494), brotli 24_348 → 24_489 (24_359). The lean profile carries the rich-text
// renderer and the fidelity ledger, so it pays for the verdict and the two
// texts like the full one; the 74 B it does not pay are the `escalated` count
// in the strategy runner it has no copy of — its `inspect().fidelity.escalated`
// is always 0, which is the truth about that profile.
// Raised 2026-09-11 (Z29): raw 87_374 → 87_676 (measured 87_557), gzip 27_544 → 27_645
// (27_592), brotli 24_489 → 24_571 (24_424). The same +293 B as the full profile: the
// wrapper is recognised in the rich-text renderer, which every profile carries.
// Raised 2026-09-11 (Z27): raw 87_676 → 89_606 (measured 89_487), gzip 27_645 → 28_359
// (28_306), brotli 24_571 → 25_233 (25_086). The same wait as the full profile
// (see INLINE_BUDGET): it is in `start()`, which every profile runs, and a
// lean runtime on a Next page has the same hydration ahead of it.
// Raised 2026-09-11 (Z31): raw 89_606 → 90_700 (measured 90_570), gzip 28_359 → 28_684
// (28_628), brotli 25_233 → 25_526 (25_364). The same wait as the full profile
// (see INLINE_BUDGET): it is in `start()`, which a lean runtime on a Nuxt page runs too.
// Raised 2026-09-12 (Testlauf B, F1): raw 91_135 → 91_436 (measured 91_332), gzip
// 28_845 → 28_938 (28_888), brotli 25_664 → 25_745 (25_578) — the measured
// difference, cushions kept. +301 B, fourteen more
// than the full profile: the lean runner has no route to refresh and now asks the
// question anyway, because a lean page that changes a field it does not bind is
// the page this reading describes. `escalated` stays 0 there, which is the truth
// about the profile rather than silence about the change.
// Raised 2026-09-14 (2.0.1, three diagnostics that said what did not happen): raw 91 436 → 91 472 (+36 B, measured 91 406 → 91 442).
// Raised 2026-09-15 (2.0.1: merge-race fix, doctor --header, migrate notice): raw 91 472 → 91 521 (+49 B, measured 91 442 → 91 491); gzip 28 938 → 28 949 (+11 B, measured 28 929 → 28 940).
// Raised 2026-09-17 (2.0.2: the shared sanitizer document, annotate's loop-item refusal, the doctor's token rule and help texts): gzip 28 949 → 28 955 (+6 B, measured 28 940 → 28 946).
// 2026-09-17 (2.0.3: the Trusted Types policy on the realm, islands hearing every change, the owed route refresh, the doctor's --token-param): raw 91 521 → 91 962 (+441 B, measured 91 508 → 91 949); gzip 28 955 → 29 069 (+114 B, measured 28 948 → 29 062).
// 2026-09-18 (2.0.3, the release build): brotli is not byte-stable — CI compressed index.js 2 B over a budget that kept 46 B over the local figure; every brotli row now keeps ~120 B (or under the 2 % notice on a small file) and every gzip row at least 12 B over this host's 2.0.3 measurement: brotli 25 745 → 25 825 (measured 25 705).
export const INLINE_LEAN_BUDGET = { raw: 91_962, gzip: 29_069, brotli: 25_825 } as const;
