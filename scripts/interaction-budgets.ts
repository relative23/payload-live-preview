/**
 * What one burst of typing may cost the network, and what one keystroke may
 * cost the editor's patience.
 *
 * Two numbers per scenario, measured by `check-interaction-budgets.ts`: the
 * merge requests an 18-keystroke burst makes, and the p95 from a keystroke to
 * the change on the page. Both are poor today; both are written down here so
 * they cannot get worse unnoticed, and so an improvement nobody records here
 * fails just as loudly as a regression.
 */

import {
  KEYSTROKES,
  PAGE_WITHOUT_BINDINGS,
  RELATIONSHIP_FIELD,
  RICH_TEXT,
  TEXT_FIELD,
  UNBOUND_FIELD,
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
 * is ours: 50 ms of debounce, one animation frame, and a render that costs less
 * than a millisecond even for a whole Lexical tree. The audit's 128 ms is this
 * number plus the demo's round trip, and that round trip is what the request
 * column is for: an update that makes no request cannot wait for one.
 */
export interface LatencyBudget {
  /**
   * Above this, the run is not the machine. A loaded runner costs about one
   * animation frame — 71 ms p95 measured with 12 busy processes on 8 cores
   * against 67 ms idle — so the ceiling sits one further frame above that.
   */
  readonly ceilingMs: number;
  /**
   * Below this, the runtime has stopped waiting a full debounce window plus a
   * frame, which is a change in behaviour and not a lucky sample: noise only
   * ever raises a p95. Whoever earns the drop lowers both numbers here.
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
  /** Absent where the edit has nothing to make visible; the requests are then the whole finding. */
  readonly latency?: LatencyBudget;
  /** What this row buys, in one sentence — the row is a decision, not an observation. */
  readonly why: string;
}

export interface InteractionMeasurement {
  readonly requests: number;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
}

export interface InteractionViolation {
  readonly metric: 'requests' | 'p95 latency';
  readonly actual: string;
  readonly reason: string;
}

/** One request per accepted message, which is what LP-3 named: the debounce brakes the DOM, not the wire. */
const ONE_PER_KEYSTROKE = KEYSTROKES;

export const INTERACTION_BUDGETS: readonly InteractionBudget[] = [
  {
    scenario: TEXT_FIELD.name,
    requests: ONE_PER_KEYSTROKE,
    latency: { ceilingMs: 84, floorMs: 60 },
    // 18 requests buy nothing here. The page shows three scalars, the message
    // carries all three, and no binding reads a value the server would have to
    // populate — the merged document is the posted one. The row is written down
    // rather than argued away because it is the commonest edit there is, and
    // because Z4 turns it into a 0 that this number then has to record.
    //
    // 67 ms is 50 ms of debounce, one animation frame, and a render too small
    // to measure. Nothing here is the price of correctness: Z5's leading-edge
    // apply is what makes the first keystroke of a quiet phase land in a frame.
    why: 'the commonest edit in the product: it costs a request per keystroke and 67 ms, and neither is earned',
  },
  {
    scenario: RICH_TEXT.name,
    requests: ONE_PER_KEYSTROKE,
    latency: { ceilingMs: 84, floorMs: 60 },
    // Same two numbers as the plain text field, and that is the finding: a whole
    // Lexical tree re-rendered and sanitised on every keystroke does not show up
    // against the debounce. It is here so that it keeps not showing up — a
    // renderer that starts costing tens of milliseconds would move this row and
    // no other, which is exactly the signal a per-scenario budget exists to give.
    why: 'the largest per-keystroke render there is, held to the same 84 ms so a slow renderer is visible as one',
  },
  {
    scenario: RELATIONSHIP_FIELD.name,
    requests: ONE_PER_KEYSTROKE,
    latency: { ceilingMs: 84, floorMs: 60 },
    // The one scenario whose request is earned: the admin posts a bare id and
    // only the merged document carries the label the page shows. 18 is still
    // wrong — Z4's answer is one request per quiet phase, not one per keystroke
    // — but the floor under it is 1 and not 0, and this row is what will keep
    // an optimisation from taking that last one away. If it ever reads 0 here,
    // the page is showing an id to an editor.
    why: 'the request that buys something: keeping this row above zero is what stops the merge being optimised out',
  },
  {
    scenario: UNBOUND_FIELD.name,
    requests: ONE_PER_KEYSTROKE,
    // Pure waste, with a diagnostic already naming it: LP0201 says the page has
    // nowhere to put this field, and the runtime asks the server for it 18 times
    // anyway. No latency row, because nothing becomes visible — that absence is
    // the measurement.
    why: '18 authenticated requests for a field the page has already reported it cannot show',
  },
  {
    scenario: PAGE_WITHOUT_BINDINGS.name,
    requests: ONE_PER_KEYSTROKE,
    // LP-4, reproduced: the audit counted 19 POSTs on 17 keystrokes from a page
    // whose binding count was zero. Here the count is exactly one per message,
    // which is the same defect without the admin's own extra messages on top.
    // Nothing on this page can consume an update at all, so every request, every
    // cookie sent with it and every row it reads is spent on nothing.
    why: 'LP-4: a page with no bindings still asks the server 18 times, and cannot use a single answer',
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
