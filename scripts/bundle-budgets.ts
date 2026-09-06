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
export const INLINE_BUDGET = { raw: 98_739, gzip: 30_918, brotli: 27_395 } as const;

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
export const INLINE_LEAN_BUDGET = { raw: 81_098, gzip: 25_359, brotli: 22_557 } as const;
// The inline script with the fragment prelude ahead of the runtime (ADR 0011);
// only a page configured with `fragments` receives it. The prelude itself grew
// by the bounded streaming reader that replaced an unbounded `response.text()`.
export const INLINE_FRAGMENT_BUDGET = { raw: 110_147, gzip: 34_697, brotli: 30_581 } as const;

/**
 * The inline script with the route prelude and no fragment endpoint: the
 * delivery shape for a page that wants a route refresh and nothing more.
 *
 * The distance to `INLINE_FRAGMENT_BUDGET` is the point of the split: the route
 * prelude costs 2 058 gzip on top of the runtime, the fragment prelude 3 773.
 * The 1 723 in between are the endpoint request, the fragment protocol and its
 * abort scaffolding — none of which a route refresh calls.
 */
export const INLINE_ROUTE_BUDGET = { raw: 105_202, gzip: 33_014, brotli: 29_114 } as const;

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
