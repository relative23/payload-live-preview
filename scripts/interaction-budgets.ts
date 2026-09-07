/**
 * What one burst of typing may cost the network, and what one keystroke may
 * cost the editor's patience.
 *
 * Two numbers per scenario, measured by `check-interaction-budgets.ts`: the
 * merge requests an 18-keystroke burst makes, and the p95 from a keystroke to
 * the change on the page. Both were once one request per keystroke and one
 * debounce window; Z4 and Z5 moved them, and what stands here is where they
 * landed. They are written down so they cannot get worse unnoticed, and so an
 * improvement nobody records here fails just as loudly as a regression.
 */

import {
  PAGE_WITHOUT_BINDINGS,
  RELATIONSHIP_FIELD,
  RICH_TEXT,
  TEXT_FIELD,
  UNBOUND_FIELD,
  UNBOUND_FIELD_WITH_ROUTE,
} from './interaction-scenarios';

/**
 * How the latency number is made distribution-stable, and what it deliberately
 * leaves out.
 *
 * The audit's 128 ms was a single reading in a running demo. A budget cannot be
 * set from one reading, so the gate takes 30 samples per scenario, discards the
 * first 10 as a cold page, and states the p95 — the tail an editor notices,
 * and the one statistic that load can only push upward.
 *
 * It also leaves the network out on purpose: the merge endpoint answers without
 * delay. A REST round trip is the server's property, not this package's, and a
 * budget containing it would move when a database does while hiding the two
 * things we can move — the debounce window and the request itself. What is left
 * is ours, and since Z5 it is one thing rather than two: an animation frame,
 * plus a render that costs less than a millisecond even for a whole Lexical
 * tree. The debounce window dropped out of the sum because the first change of
 * a quiet phase is applied on the leading edge and no longer waits for it. The
 * request column carries the other half of what an editor waits for: an update
 * that makes no request cannot wait for one, and four of the five rows below
 * now make none.
 */
export interface LatencyBudget {
  /**
   * Above this, the run is not the machine — and the band is deliberately
   * narrower than the one it replaces, because the number it guards is four
   * times smaller. Idle p95 is 16.5–17.3 ms across three runs; 12 busy
   * processes on 8 cores put it at 19.8–20.4, and 24 on 8 at 22.2–26.5. The
   * ceiling clears the worst of those and still sits under the ~33 ms a second
   * animation frame would cost, so a write that starts needing one more frame
   * is a red run rather than slack a loaded machine can hide in.
   */
  readonly ceilingMs: number;
  /**
   * Below this, the runtime has stopped waiting for an animation frame at all,
   * which is a change in behaviour and not a lucky sample: noise only ever
   * raises a p95. A frame is 16.5 ms here (jsdom with `pretendToBeVisual`), so
   * nothing that still schedules through one can land under this number.
   * Whoever earns the drop lowers both numbers here.
   */
  readonly floorMs: number;
}

export interface InteractionBudget {
  readonly scenario: string;
  /**
   * Exact, not a ceiling. The count is an integer with no noise in it, so a
   * measurement that comes in under budget is news and not slack.
   */
  readonly requests: number;
  /**
   * Route refreshes the same burst may cost, on the one page that has a route
   * strategy. Exact for the same reason, and in both directions: too many is a
   * brake that stopped braking, too few is a change the brake swallowed.
   */
  readonly routeRefreshes?: number;
  /** Absent where the edit has nothing to make visible; the requests are then the whole finding. */
  readonly latency?: LatencyBudget;
  /** What this row buys, in one sentence — the row is a decision, not an observation. */
  readonly why: string;
}

export interface InteractionMeasurement {
  readonly requests: number;
  readonly routeRefreshes?: number;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
}

export interface InteractionViolation {
  readonly metric: 'requests' | 'route refreshes' | 'p95 latency';
  readonly actual: string;
  readonly reason: string;
}

/**
 * One request opens a quiet phase and one closes it: `MergeNeed.request` sends
 * the leading message straight out and coalesces everything that arrives inside
 * the window behind it. Eighteen keystrokes buy two, and only where the page
 * needs an answer at all.
 */
const LEADING_AND_TRAILING = 2;

export const INTERACTION_BUDGETS: readonly InteractionBudget[] = [
  {
    scenario: TEXT_FIELD.name,
    requests: 0,
    latency: { ceilingMs: 30, floorMs: 12 },
    // Zero, and zero is the entire point of the row. The page shows three
    // scalars, the message carries all three, and no binding reads a value only
    // the server could populate — so `MergeNeed.decide` answers "no server" and
    // the commonest edit in the product costs the network nothing. The number is
    // exact in both directions: a merge that creeps back in for this shape, for
    // whatever good reason, has to be argued for here first.
    //
    // 16.5 ms is one animation frame and nothing else. The debounce window is
    // not in it, because the first change of a quiet phase is applied on the
    // leading edge; the network is not in it, because there is no request.
    why: 'the commonest edit in the product: no request at all, and one animation frame from keystroke to page',
  },
  {
    scenario: RICH_TEXT.name,
    requests: LEADING_AND_TRAILING,
    latency: { ceilingMs: 30, floorMs: 12 },
    // Two rather than zero, and the two are earned: a Lexical tree can contain a
    // reference, so the structure is written from the message at once and the
    // server is only asked what sits inside it. The editor never waits for that
    // answer, which is why this row's latency is the plain field's.
    //
    // That equality is still the finding it was: a whole tree re-rendered and
    // sanitised on every keystroke does not show up against a single frame. It
    // is here so that it keeps not showing up — a renderer that starts costing
    // tens of milliseconds moves this row and no other.
    why: 'the largest per-keystroke render there is, held to the same frame so a slow renderer shows up as one',
  },
  {
    scenario: RELATIONSHIP_FIELD.name,
    requests: LEADING_AND_TRAILING,
    latency: { ceilingMs: 30, floorMs: 12 },
    // The one scenario whose request buys something: the admin posts a bare id
    // and only the merged document carries the label the page shows. Two per
    // burst is one per quiet phase, which is what LP-3 asked for.
    //
    // This is the row that must not be allowed to reach zero, and the exactness
    // is what stops it: an optimisation that decides nobody needs the merge
    // reads 0 here and fails with "below the 2 written down". A green run on
    // this line is the assertion that the page shows a name and not an id.
    why: 'the request that buys something: an exact 2 is what keeps the merge from being optimised away',
  },
  {
    scenario: UNBOUND_FIELD.name,
    requests: 0,
    // The diagnostic was always the right answer here, and now it is the only
    // cost: LP0201 says the page has nowhere to put this field, and the runtime
    // no longer asks the server for it eighteen times anyway. No latency row,
    // because nothing becomes visible — that absence is the measurement.
    why: 'a field the page has already reported it cannot show now costs nothing to type into',
  },
  {
    scenario: UNBOUND_FIELD_WITH_ROUTE.name,
    requests: 0,
    routeRefreshes: 2,
    // LP-5, and the row that says what the brake is for. The same page as above,
    // given the route strategy it would have in a real project: the server's own
    // render is the only thing that can show a field nothing binds.
    //
    // Two, and both halves matter. Not eighteen, because the strategy paces
    // itself at one refresh per 1 000 ms and 18 keystrokes 30 ms apart fit
    // inside one window — that part always worked. Not one, because what the
    // window held back used to be dropped: the audit typed two unbound changes
    // 286 ms apart, saw one refresh and one refusal, and the second change never
    // reached the preview at all. The refused request is now run once when the
    // window closes, which is the second refresh here and the whole finding.
    //
    // Still 0 merge requests: a refresh re-renders the page from the server and
    // reads none of the populated values a merge would resolve, so it is not a
    // reason to ask for one (Z4).
    why: 'LP-5: a burst costs one refresh that opens the window and one that closes it, and nothing is lost in between',
  },
  {
    scenario: PAGE_WITHOUT_BINDINGS.name,
    requests: 0,
    // LP-4, closed. The audit counted 19 POSTs on 17 keystrokes from a page
    // whose binding count was zero; `readsPopulatedValues` now answers before
    // the first of them, so no request, no cookie and no row is spent on a page
    // that could not have used the answer. The row stays to hold it there.
    why: 'LP-4: a page with no bindings asks the server nothing, and this 0 is what keeps it that way',
  },
];

/** Both directions: a budget that only stops regressions lets an unrecorded win rot. */
export function findInteractionViolations(
  measurement: InteractionMeasurement,
  budget: InteractionBudget,
): readonly InteractionViolation[] {
  const violations: InteractionViolation[] = [];
  if (measurement.requests !== budget.requests) {
    violations.push({
      metric: 'requests',
      actual: String(measurement.requests),
      reason:
        measurement.requests > budget.requests
          ? `above the ${budget.requests} this scenario is allowed`
          : `below the ${budget.requests} written down — record the improvement here`,
    });
  }
  if (measurement.routeRefreshes !== budget.routeRefreshes) {
    violations.push({
      metric: 'route refreshes',
      actual:
        measurement.routeRefreshes === undefined
          ? 'not measured'
          : String(measurement.routeRefreshes),
      reason:
        budget.routeRefreshes === undefined
          ? 'the scenario refreshed a route the budget says nothing about'
          : `not the ${String(budget.routeRefreshes)} this scenario is allowed — too many is a brake that stopped braking, too few is a change it swallowed`,
    });
  }
  const { latency } = budget;
  const p95 = measurement.p95Ms;
  if (latency === undefined || p95 === undefined) {
    if (latency !== undefined) {
      violations.push({
        metric: 'p95 latency',
        actual: 'not measured',
        reason: 'the budget states a latency the scenario never makes visible',
      });
    }
    return violations;
  }
  if (p95 > latency.ceilingMs) {
    violations.push({
      metric: 'p95 latency',
      actual: `${p95.toFixed(1)} ms`,
      reason: `above the ${latency.ceilingMs} ms ceiling`,
    });
  } else if (p95 < latency.floorMs) {
    violations.push({
      metric: 'p95 latency',
      actual: `${p95.toFixed(1)} ms`,
      reason: `below the ${latency.floorMs} ms floor — lower both numbers in this row`,
    });
  }
  return violations;
}
