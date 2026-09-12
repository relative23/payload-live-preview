/**
 * The byte budgets of the two inline profiles that carry a prelude ahead of the
 * runtime — fragments (ADR 0011) and the route refresh — and the log of why
 * each number is what it is. Split out of `bundle-budgets.ts` on 2026-09-11,
 * when that log reached the 500-line limit for the second time; the runtime
 * profiles and their reasons stay there, and every "the prelude did not move"
 * below refers to the runtime's own change recorded in `INLINE_BUDGET`.
 */

// The inline script with the fragment prelude ahead of the runtime (ADR 0011);
// only a page configured with `fragments` receives it. The prelude itself grew
// by the bounded streaming reader that replaced an unbounded `response.text()`.
// Raised 2026-09-07 (LP-1, brotli only): 30 581 → 30 690 (measured 30 566). Raw
// and gzip still hold — this profile had the most room — so only the metric that
// does not reproduce gets its cushion back.
// Raised 2026-09-07 (LP-2): raw 110 147 → 110 930 (measured 110 812), gzip
// 34 697 → 34 975 (measured 34 927), brotli 30 690 → 30 910 (measured 30 748).
// Lowered 2026-09-07 (Z19): brotli 30 910 → 30 870, measured 30 748 on a build
// that now reproduces. Of the four inline profiles this one had kept the widest
// cushion — 162 B where the file documents ~120 — because it had the most room
// when the noise was paid for. The other three sit between 115 and 121 B over
// their measurement and stay where LP-2 left them.
// Raised 2026-09-07 (Z3): raw 110 930 → 112 210 (measured 112 094), gzip 34 975
// → 35 390 (measured 35 339), brotli 30 870 → 31 240 (measured 31 111). This is
// the profile the escalation is actually for: with both preludes present a
// finding inside a boundary goes to the fragment endpoint and only one outside
// every boundary reaches the route.
// Raised 2026-09-07 (Z4): raw 112 210 → 114 930 (measured 114 806), gzip 35 390 →
// 36 220 (measured 36 163), brotli 31 240 → 31 900 (measured 31 775). A boundary
// is rendered by a server that is handed exactly these fields, so this profile
// is also the one where a page with no binding at all still has a consumer — and
// the decision asks the DOM for a boundary before it decides that it has none.
// Raised 2026-09-07 (Z5): raw 114 930 → 115 100 (measured 114 978). Both prelude
// profiles move by the same 172 B as the runtime they wrap; gzip and brotli hold.
// Raised 2026-09-07 (Z6): raw 115 100 → 115 790 (measured 115 668), gzip 36 220 →
// 36 460 (measured 36 420), brotli 31 900 → 32 150 (measured 32 022). Both
// prelude profiles move by the runtime's 331 B plus the 237 B the route strategy
// itself grew: the trailing hand-back, and the branch that prefers a host's own
// router refresh to fetching the route and morphing it.
// Raised 2026-09-07 (Z7): raw 115_790 → 116_030 (measured 115_912), gzip
// 36_460 → 36_560 (measured 36_511). Brotli holds. Both prelude profiles move
// by the runtime's 244 B and nothing of their own.
// Raised 2026-09-07 (Z22): raw 116_030 → 116_480 (measured 116_360), gzip
// 36_560 → 36_620 (measured 36_574), brotli 32_150 → 32_230 (measured 32_108).
// The brotli row did not cross; the growth left it 42 B under, and this file
// keeps ~120 for the one difference it cannot measure here.
// Raised 2026-09-10 (Z9): the runtime's own +3 913 B raw; the prelude did not move.
// Lowered 2026-09-10 (Z25): raw 121_260 → 119_973 (measured 119_863), gzip
// 38_386 → 37_868 (37_818), brotli 33_758 → 33_275 (33_145) — the runtime's
// own −1 287 B, the diagnostic table; the prelude did not move.
// Raised 2026-09-10 (Z26): raw 119_973 → 120_894 (measured 120_773), gzip
// 37_868 → 38_164 (38_109), brotli 33_275 → 33_526 (33_399) — the runtime's
// own +910 B; the prelude did not move.
// Lowered 2026-09-11 (Z28): raw 120_894 → 120_077 (measured 119_956), gzip 38_164 → 38_026
// (37_971), brotli 33_526 → 33_416 (33_286) — the runtime's own −817 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z30): raw 120_077 → 120_841 (measured 120_720), gzip 38_026 → 38_207
// (38_152), brotli 33_416 → 33_575 (33_445) — the runtime's own +764 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z29): raw 120_841 → 121_143 (measured 121_013), gzip 38_207 → 38_302
// (38_246), brotli 33_575 → 33_647 (33_517) — the runtime's own +293 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z27): raw 121_143 → 123_068 (measured 122_938), gzip 38_302 → 39_010
// (38_954), brotli 33_647 → 34_239 (34_109) — the runtime's own +1 925 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (merge of main #64/#65): by the measured difference to the
// merged tree, cushions kept (route 119_071 → 119_506 raw measured).
// Raised 2026-09-11 (Z31): raw 123_068 → 124_153 (measured 124_023), gzip 39_010 → 39_338
// (39_282), brotli 34_239 → 34_589 (34_427) — the runtime's own +1 085 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-12 (Testlauf B, F1): raw 124_588 → 124_875 (measured 124_754),
// gzip 39_505 → 39_588 (39_537), brotli 34_740 → 34_803 (34_631) — the runtime's
// own +287 B (see INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-12 (B-01): raw 124_875 → 125_051 (measured 125_038) — the
// runtime's own +176 B (see INLINE_BUDGET); the prelude did not move.
export const INLINE_FRAGMENT_BUDGET = { raw: 125_051, gzip: 39_588, brotli: 34_803 } as const;

/**
 * The inline script with the route prelude and no fragment endpoint: the
 * delivery shape for a page that wants a route refresh and nothing more.
 *
 * The distance to `INLINE_FRAGMENT_BUDGET` is the point of the split: the route
 * prelude costs 2 058 gzip on top of the runtime, the fragment prelude 3 773.
 * The 1 723 in between are the endpoint request, the fragment protocol and its
 * abort scaffolding — none of which a route refresh calls.
 */
// Raised 2026-09-07 (LP-1): raw 105 202 → 105 380 (measured 105 214), gzip
// 33 014 → 33 070 (measured 33 016), brotli 29 114 → 29 180 (measured 29 049).
// Both prelude profiles move by the same 431 B as the runtime they wrap; the
// distance between the two, which is the point of this pair, is unchanged.
// Raised 2026-09-07 (LP-2): raw 105 380 → 106 000 (measured 105 886), gzip
// 33 070 → 33 300 (measured 33 258), brotli 29 180 → 29 390 (measured 29 271).
// Both prelude profiles move by the same 672 B as the runtime they wrap.
// Raised 2026-09-07 (Z3): raw 106 000 → 107 280 (measured 107 168), gzip 33 300
// → 33 730 (measured 33 675), brotli 29 390 → 29 780 (measured 29 658). Both
// prelude profiles move by the same 1 303 B as the runtime they wrap.
// Raised 2026-09-07 (Z4): raw 107 280 → 109 990 (measured 109 880), gzip 33 730 →
// 34 540 (measured 34 490), brotli 29 780 → 30 470 (measured 30 342). Both
// prelude profiles move by the same 2 712 B as the runtime they wrap. The route
// prelude is the one this decision deliberately does not count as a reason to
// ask: a refresh re-renders the page from the server and never reads the merged
// values, so a page whose only answer to an edit is a route refresh now makes no
// REST request at all.
// Raised 2026-09-07 (Z5): raw 109 990 → 110 170 (measured 110 052), gzip 34 540 →
// 34 590 (measured 34 541). Brotli holds. This is the profile where the leading
// write matters least and is still worth its bytes: a route refresh is a
// server round trip either way, and the patch that lands before it is what the
// editor sees in the meantime.
// Raised 2026-09-07 (Z6): raw 110 170 → 110 860 (measured 110 744), gzip 34 590 →
// 34 800 (measured 34 756), brotli 30 470 → 30 710 (measured 30 584). This is the
// profile the change is for. Of the 574 B, 237 are the strategy's own: a refusal
// hands the request back instead of dropping it, and a page that has registered
// a router refresh gets a re-render the framework performs rather than HTML this
// package morphs over a reconciler's nodes — which also removes the second HTML
// request from every refresh such a page makes.
// Raised 2026-09-07 (Z7): raw 110_860 → 111_100 (measured 110_988), gzip
// 34_800 → 34_890 (measured 34_841). Brotli holds. The route profile is the one
// that acts on an unbound change; now the console names the field inside the
// group it refreshed the page for.
// Raised 2026-09-07 (Z22): raw 111_100 → 111_550 (measured 111_436), gzip
// 34_890 → 35_040 (measured 34_995), brotli 30_710 → 30_890 (measured 30_767).
// Both prelude profiles move by the runtime's 448 B and nothing of their own.
// Raised 2026-09-10 (Z9): the runtime's own +3 913 B raw; the prelude did not move.
// Lowered 2026-09-10 (Z25): raw 116_308 → 115_021 (measured 114_911), gzip
// 36_730 → 36_205 (36_155), brotli 32_306 → 31_885 (31_755) — the runtime's
// own −1 287 B, the diagnostic table; the prelude did not move.
// Raised 2026-09-10 (Z26): raw 115_021 → 115_942 (measured 115_821), gzip
// 36_205 → 36_492 (36_437), brotli 31_885 → 32_081 (31_934) — the runtime's
// own +910 B, in the profile whose refresh strips the stamps they restore.
// Lowered 2026-09-11 (Z28): raw 115_942 → 115_125 (measured 115_004), gzip 36_492 → 36_355
// (36_300), brotli 32_081 → 31_972 (31_825) — the runtime's own −817 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z30): raw 115_125 → 115_889 (measured 115_768), gzip 36_355 → 36_539
// (36_484), brotli 31_972 → 32_143 (31_996) — the runtime's own +764 B (see
// INLINE_BUDGET); the prelude did not move. This is the profile in which the
// LP0413 verdict has somewhere to go: the route redraws the region.
// Raised 2026-09-11 (Z29): raw 115_889 → 116_191 (measured 116_061), gzip 36_539 → 36_631
// (36_575), brotli 32_143 → 32_212 (32_065) — the runtime's own +293 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z27): raw 116_191 → 118_116 (measured 117_986), gzip 36_631 → 37_344
// (37_288), brotli 32_212 → 32_848 (32_701) — the runtime's own +1 925 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-11 (Z31): raw 118_116 → 119_201 (measured 119_071), gzip 37_344 → 37_673
// (37_617), brotli 32_848 → 33_153 (32_991) — the runtime's own +1 085 B (see
// INLINE_BUDGET); the prelude did not move.
// Raised 2026-09-12 (Testlauf B, F1): raw 119_636 → 119_923 (measured 119_800),
// gzip 37_840 → 37_925 (37_873), brotli 33_288 → 33_352 (33_187) — the runtime's
// own +287 B (see INLINE_BUDGET). This is the profile that acts on the finding:
// the refresh was always taken, only the ledger behind it was empty.
// Raised 2026-09-12 (B-01): raw 119_923 → 120_099 (measured 120_084), gzip
// 37_925 → 37_970 (37_954) — the runtime's own +176 B (see INLINE_BUDGET); the
// prelude did not move.
export const INLINE_ROUTE_BUDGET = { raw: 120_099, gzip: 37_970, brotli: 33_352 } as const;
