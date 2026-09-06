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
export const INLINE_BUDGET = { raw: 99_550, gzip: 31_200, brotli: 27_680 } as const;

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
export const INLINE_LEAN_BUDGET = { raw: 81_920, gzip: 25_650, brotli: 22_850 } as const;
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
export const INLINE_FRAGMENT_BUDGET = { raw: 110_930, gzip: 34_975, brotli: 30_870 } as const;

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
export const INLINE_ROUTE_BUDGET = { raw: 106_000, gzip: 33_300, brotli: 29_390 } as const;

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
