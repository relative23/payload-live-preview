import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

export interface BundleMeasurement {
  readonly raw: number;
  readonly gzip: number;
  readonly brotli: number;
}

export type BundleBudget = BundleMeasurement;

/** Exact inline transfer-size ceilings used by the release gate. */
// Set 2026-08-28 after the 2.0 correctness pass: 26 910 → 28 736 gzip. The
// +1 745 is new behaviour, not slack — Payload 3.x link/table/inline-block
// rendering, class-based Lexical output, `mailto:` and responsive-image
// writes, local-time date inputs, one value contract across the renderers,
// the morph's focus and selection restore, and the scheduler's flush deadline.
// A page without `fragments` still carries no fragment client at all; that
// client is the difference to INLINE_FRAGMENT_BUDGET.
//
// Raised again the same day: 28 736 → 28 923 gzip. The +187 buys the reveal's
// identity ledger, which lets a field the server re-renders be recognised as
// the edited one, the binding-level reveal that picks the edited document's
// element when a page previews several, and a rejection boundary around the
// update pipeline so an unexpected throw is logged instead of escaping.
//
// Raised 2026-09-04: 28 923 → 28 966 gzip. The +43 makes the reveal ledger
// record what a revision revealed rather than what it saw, so a message that
// supersedes one before its reveal point still owes — and pays — the reveal.
// A slow first reveal caused the admin to re-send, and the re-send cancelled
// the only reveal there was; Firefox in CI reproduced it one run in seven.
//
// Raised 2026-09-05: 28 966 → 29 035 gzip. The +69 is net. The sanitizer
// policy became instance state (ADR 0002) — it travels through the runtime
// options into every render context, so two clients on one page no longer
// share whichever policy was set last — and that costs about a hundred bytes;
// the LRU helpers behind both caches and the fragment client's shared abort
// scaffolding give a third of it back. The reveal ledger as its own module and
// the `revision` and `hidesWhenEmpty` names are free.
//
// Raised 2026-09-06: 29 035 → 29 071 gzip. The +36 is what every page pays so
// that any page can refresh its route. The route strategy used to arrive only
// inside the fragment prelude, which the generator emitted only for a page that
// configured a fragment endpoint — so `data-payload-strategy="route"` and a
// binding in `<head>` did nothing outside Astro, the one framework with an
// endpoint helper. The runtime now looks for a second prelude
// (`__LIVE_PREVIEW_ROUTE__`) as well, and those two `typeof` checks and the
// branch between them are the bytes. A page that carries neither prelude still
// carries no strategy code at all.
//
// Raised 2026-09-06: 29 071 → 29 729 gzip. The +658 buys `onUnboundChange`: the
// runtime now knows whether a changed field has anywhere on the page to land,
// and can refresh the route instead of dropping the edit. Most of it is the
// addressability rules that the LP0201 diagnostic and the strategy decision now
// share (`src/core/unbound-fields.ts`) — the locale suffix, the owner scope, and
// the fact that a binding on `hero.eyebrow` covers the top-level field `hero`
// the diff reports. The rest is the baseline flag on the diff and the LP0807
// message.
//
// This is the largest single raise so far, and a page that leaves the option at
// `'ignore'` pays it too. It is in the runtime rather than in the route prelude
// because the decision needs the binding cache, the message locale and the owner
// scope, none of which cross the strategy seam — moving it would mean a second,
// weaker copy of the same rules. Making the seam carry them is the way to get
// these bytes back; see the Ü9 note in the private roadmap.
//
// Raised 2026-09-06: 29 729 → 30 221 gzip. The +492 is `data-payload-format`:
// the closed vocabulary that decides how a date or a number is written, and the
// LP0408 message that names the whole vocabulary when a page asks for something
// outside it. It buys the fields a template formats server-side — a price, a
// long date — the ability to be bound at all; until now they had to be left out,
// and a field nobody binds is one an editor changes without seeing anything.
//
// Raised 2026-09-06: 30 221 → 30 290 gzip. The +32 measured is the two strategy
// warnings (LP0407, LP0806) becoming shared functions rather than methods, so
// the lean profile below can keep answering a page that asks for a strategy it
// does not carry. The rest is headroom.
//
// Raised 2026-09-06 (Ü11): +165 gzip for LP0503 — the line a page prints when an
// admin it trusts sends a message this runtime does not recognise. The wire
// format is mirrored by hand here, so drift was silent until now: the message
// was dropped and the preview simply stopped updating. One sentence in the
// console is what turns that into a report.
// 2026-09-06 (LP0409): +~450 B raw / ~130 B gzip in every inline profile for
// the message the strict sanitizer prints when it drops an attribute the 1.x
// `'compat'` default kept. The lean profile carries it too: the sanitizer is
// not one of the features that profile leaves out, so the report belongs there
// as much as anywhere.
// 2026-09-07 (LP-1, the relationship tracker): every artifact that embeds the
// runtime rises +431 B raw / ~120 B gzip / ~110 B brotli, measured against the
// same build without the change. The bytes are an identity for Payload's
// document event and a comparison against the document the message previews.
// `externallyUpdatedRelationship` is not a flag: the panel fills it from
// `useDocumentEvents().mostRecentUpdate`, which every save of the previewed
// document raises and which nothing ever clears, so from the first save on it
// was set in every message. What stood here before was `typeof x === 'object'`,
// and the distance between "the field is present" and "the field means
// something that has not happened yet" is exactly this code — an identity kept
// between messages (`entitySlug`, id, `updatedAt`; never id alone, a global's
// save carries none) plus the slug-and-id comparison. Replaying the recorded
// 3.88 admin session that crosses a save: four `relationshipUpdate` events
// become none, and thirteen writes after the save are skipped that were not.
// About a third of it is the id comparison, and that third is what keeps a page
// previewing a collection from missing a sibling document's save; dropping it
// would fit under the old numbers and hand back half the finding.
//
// Raised 2026-09-07: raw 98 739 → 98 930 (measured 98 777). The gzip and the
// fragment-profile raw rows below still hold and stay where they are.
//
// Raised 2026-09-07 (brotli): 27 395 → 27 500 (measured 27 371). Not paid for by
// new code — it restores the ~120 B cushion this file has documented since
// 2026-08-27 and which the raise above ate. Brotli does not reproduce here:
// three builds from byte-identical raw and gzip output measured 49 731, 49 758
// and 49 785 B for `index.js`. A row sitting 24 B under its ceiling is a coin
// flip, not a budget.
//
// Corrected the same day: the observation was right, the explanation was not.
// Brotli is deterministic; the artifact was not. Two builds had the same raw
// length and the same gzip but six different bytes, all of them inside
// `RUNTIME_BUILD_INFO.generatedAt` — a wall clock embedded in the runtime that
// `index.js` and `index.cjs` carry. A substitution of equal length is invisible
// to raw and to gzip and visible to brotli, which is why only brotli looked
// unstable. `npm run build:runtime` now derives SOURCE_DATE_EPOCH from the
// tested commit the way `.github/workflows/build.yml` already did, so two builds
// of one commit are byte-identical on a developer machine as well
// (`tests/integration/reproducible-runtime-build.test.ts`). The cushion stays
// for the one difference this host cannot measure — the brotli library in CI's
// Node — not for a build that moved under its own feet.
//
// 2026-09-07 (LP-2, keeping a block the registry cannot render): every artifact
// that embeds the runtime rises +672 B raw / ~245 B gzip / ~190 B brotli — the
// lean profile +643, which is the same code minus what it shares with the morph
// it does not carry. Measured against the same build without the change.
//
// What the bytes buy is an image that stops disappearing. A `block` node whose
// slug has no registered renderer rendered as an empty `<div class="lp-block
// lp-block--mediablock">`, and that empty div was written over the `<figure>`
// with the `<img>` the project's own server had already rendered for it. In the
// demo: 1 286 characters and one image before the patch, 501 and none after,
// triggered by an edit to the *title*. The runtime now writes the rest of the
// document and leaves that subtree standing — it pairs each placeholder with
// the live element in its position and moves it across, descending only while
// the child counts agree, so a page whose markup does not line up gets exactly
// what it got before. The rest is LP0410, the line that names the slug to
// register; without it the reader sees a block that renders in one place and
// not the other, and nothing anywhere says why.
//
// Raised 2026-09-07 (LP-2): raw 98 930 → 99 550 (measured 99 449), gzip 30 918 →
// 31 200 (measured 31 156), brotli 27 500 → 27 680 (measured 27 559).
//
// 2026-09-07 (Z3, escalate instead of degrade): every artifact that embeds the
// runtime rises +1 303 B raw / ~440 B gzip / ~390 B brotli, the lean profile
// +907, measured against the same build without the change. Four things,
// measured apart: the fidelity verdict itself and its LP0411 line 380 B, the
// escalation (fragment when a boundary covers the finding, route otherwise)
// 248 B, the plan-over-chosen-boundaries the escalation shares with
// `planFragments` 131 B, the flush that drains the queue 132 B; the rest is the
// two reporting sites in the writer, the one in the rich-text write, and two
// fields on the runtime state.
//
// What the bytes buy is the difference between "as complete as the annotation"
// and "never worse than the route". The runtime already knew, and threw away,
// three facts: a renderer that refused the value it was handed (LP0402 said so
// and nothing acted on it), a Lexical block whose server markup the write had
// to drop because the two trees do not line up (Z2 left exactly this case
// degrading), and a changed field with no anchor anywhere. Each of those leaves
// the page showing something the server would not have drawn. They now escalate
// to whichever strategy can draw the region, once per element — and a page with
// no strategy at all pays these bytes for nothing but the diagnostic, which is
// the same trade `onUnboundChange` already made and the reason both live in the
// runtime rather than behind the strategy seam.
//
// Raised 2026-09-07 (Z3): raw 99 550 → 100 840 (measured 100 731), gzip 31 200 →
// 31 620 (measured 31 572), brotli 27 680 → 28 090 (measured 27 965).
//
// 2026-09-07 (Z4, merge only when it adds something): every artifact that embeds
// the runtime rises +2 712 B raw / ~830 B gzip / ~700 B brotli, the lean profile
// +2 716, measured against the same build without the change. Two parts, each
// measured on its own by building the change minus that part: the decision
// itself 1 333 B (`src/core/merge-need.ts` — what the page reads, what one
// changed field is worth, and the document carried over from the last answer),
// the window a burst of requests shares 1 013 B, and the remaining 462 B the
// pipeline plumbing both need (the resolved document as its own step, the
// refinement pass, the window on the runtime's dependencies).
//
// What the bytes buy is a request per keystroke. Every accepted message cost one
// authenticated POST to Payload's REST API to have its relationships populated —
// 18 messages, 18 requests, and 19 of them on a page with no binding at all,
// where nobody could read the answer. The runtime now asks only when the answer
// can change what the page shows: a plain text field costs nothing, a page of
// plain scalar bindings costs nothing, and a burst on a relationship or a
// rich-text field costs two requests instead of eighteen — one that opens it,
// one that closes it. That last line must not fall to zero, and the tests
// (`tests/unit/core/merge-need.test.ts`) count it: without a request the page
// would show a document id where its title belongs.
//
// It is in the runtime rather than behind an option because the decision needs
// the binding cache, the message diff and the last resolved document at once,
// and because a page that pays for it is every page: the runtime that does not
// carry it is the one that never merges, and that one has no `dataMerge` and
// makes no request either way. A project that turns the debounce off turns the
// window off with it and keeps the two skips.
//
// Raised 2026-09-07 (Z4): raw 100 840 → 103 550 (measured 103 443), gzip 31 620 →
// 32 450 (measured 32 397), brotli 28 090 → 28 750 (measured 28 630).
//
// 2026-09-07 (Z5, the write that opens a quiet phase): every artifact that
// embeds the runtime rises +172 B raw / ~50 B gzip / ~50 B brotli, measured
// against the same build without the change. It is one timestamp, one
// comparison and one branch in the scheduler, plus the guard that keeps a
// window from flushing a buffer its own leading write already emptied.
//
// What the bytes buy is 50 ms. Until now a keystroke waited out the whole
// debounce before anything reached the DOM — 66.6 ms p95 in the jsdom
// interaction gate, of which 50 was a window with nothing to coalesce, because
// the first message of a quiet phase is alone in it by definition. The first
// write now goes out on the next frame and opens the window that batches the
// rest of the burst: 16.6 ms p95, one animation frame, and the debounce still
// does what it was for. This is only reachable because Z4 took the merge out of
// the common path — a leading write that had to wait for a REST round trip
// would be a frame plus the network, which is what it was replacing.
//
// It is not an option because the choice it makes is not one a page can state
// per edit: the burst a debounce exists for begins with a write that is not yet
// a burst. A page that sets `debounceMs: 0` has no window and is unaffected.
//
// Raised 2026-09-07 (Z5): raw 103 550 → 103 720 (measured 103 615). gzip and
// brotli still hold and stay where Z4 left them — gzip by one byte, which the
// next task in this runtime will have to raise.
// Raised 2026-09-07 (Z6): raw 103 720 → 104 160 (measured 104 051), gzip 32 450 →
// 32 610 (measured 32 568), brotli 28 750 → 28 950 (measured 28 829). The 331 B
// are the trailing run of a refused route refresh and the counter that stops
// calling it a failure. The audit measured two unbound changes 286 ms apart
// against a 1 000 ms minimum interval: one refresh, one refusal, and nothing
// afterwards — an editor who stopped typing there never saw the second change.
// The refusal now asks the runtime to run it once when the window closes, and
// the runtime holds at most one such request, always the newest.
//
// It is in the runtime and not in the prelude because the timer belongs to the
// revision, not to the request: the runtime is what knows whether the revision
// that asked is still the one on screen, and a newer one cancels it.
export const INLINE_BUDGET = { raw: 104_160, gzip: 32_610, brotli: 28_950 } as const;

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
export const INLINE_LEAN_BUDGET = { raw: 85_830, gzip: 26_880, brotli: 23_850 } as const;
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
export const INLINE_FRAGMENT_BUDGET = { raw: 115_790, gzip: 36_460, brotli: 32_150 } as const;

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
export const INLINE_ROUTE_BUDGET = { raw: 110_860, gzip: 34_800, brotli: 30_710 } as const;

export interface BudgetViolation {
  readonly metric: keyof BundleMeasurement;
  readonly actual: number;
  readonly limit: number;
}

/** Measure the exact bytes used by the release-size gate. */
export function measureBundle(input: string | Uint8Array): BundleMeasurement {
  const bytes = typeof input === 'string' ? Buffer.from(input) : Buffer.from(input);
  return {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

/** Return every exceeded dimension rather than hiding failures behind the first one. */
export function findBudgetViolations(
  measurement: BundleMeasurement,
  budget: BundleBudget,
): readonly BudgetViolation[] {
  const violations: BudgetViolation[] = [];
  for (const metric of ['raw', 'gzip', 'brotli'] as const) {
    if (measurement[metric] > budget[metric]) {
      violations.push({ metric, actual: measurement[metric], limit: budget[metric] });
    }
  }
  return violations;
}
