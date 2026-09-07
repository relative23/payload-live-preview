/**
 * What one anonymous visitor is charged, per delivery path.
 *
 * A row is one wiring in `examples/`, requested without a cookie, without
 * preview intent and without a session — the request every visitor makes. Two
 * exact integers hold it: how many `<script>` elements of the response carry
 * this package's bytes, and how many bytes those elements are once the runtime
 * artifact inside them is taken out. Both are written down so a path that
 * starts charging more fails, and so a path that stops charging fails just as
 * loudly until the win is recorded here.
 */

/** What the delivery put in front of a visitor who is not an editor. */
export type Carries = 'nothing' | 'bootstrap' | 'runtime';

export interface DeliveryBudget {
  readonly name: string;
  readonly app: string;
  readonly path: string;
  readonly carries: Carries;
  /** Whether `data-payload-*` attributes are in the public markup. */
  readonly bindings: boolean;
  /**
   * `<script>` elements of the response whose content mentions
   * `__LIVE_PREVIEW_CONFIG__`. Normally one, or none. Next renders the head of
   * a layout a second time into its RSC flight payload, so a Next row is two —
   * the visitor downloads the delivery twice, and that is a number rather than
   * a footnote.
   */
  readonly scriptElements: number;
  /**
   * Exact bytes of the `<script>` element the delivery emits, tag included,
   * **minus the runtime artifact it embeds**.
   *
   * The runtime's own size is not repeated here. It is gated to the byte by
   * `INLINE_BUDGET` in `scripts/bundle-budgets.ts`, it moves with every change
   * to `src/`, and a second exact copy of it in this file would make every
   * source change red in a test file whose owner did not make it. What is left
   * after subtracting it belongs to the delivery alone: the tag, the config
   * prelude, and any prelude the options asked for. That number moves only when
   * a delivery changes, which is the thing this gate is for.
   */
  readonly overheadBytes: number;
  /** What this row buys, in one sentence — the row is a decision, not an observation. */
  readonly why: string;
}

/**
 * Measured against every row. `emittedBytes` and `pageBytes` are reported
 * rather than budgeted; the paragraph on `overheadBytes` says why the first
 * cannot be pinned, and the block below it why the second cannot.
 */
export interface DeliveryMeasurement {
  readonly carries: Carries;
  readonly bindings: boolean;
  readonly scriptElements: number;
  readonly overheadBytes: number;
  /** The whole emitted element, runtime included: what the row costs today. */
  readonly emittedBytes: number;
  /** The whole public response. */
  readonly pageBytes: number;
}

/*
 * Two numbers this table deliberately does not hold.
 *
 * **The response total**, which is the number LP-8 quoted. It is the wrong one
 * to ratchet. Two thirds of the Next row is the runtime, twice — once in the
 * element and once escaped into the flight payload — so the total moves with
 * every byte of `src/`, exactly the coupling `overheadBytes` exists to avoid.
 * And it does not reproduce everywhere: the Nuxt dev server writes the absolute
 * checkout path into two hrefs, so its total is as long as the directory this
 * repository happens to sit in. The totals are measured and printed instead.
 *
 * **gzip**, which is what actually crosses the wire. It is not byte-stable
 * across Node majors: measured on 6 September, one and the same 97 672-byte
 * inline script compressed to 30 497 bytes under Node 24 and 30 520 under Node
 * 22, the version CI runs. A gate demanding an exact gzip figure would be red on
 * a runner and green here for a reason nobody can act on. Raw bytes reproduce
 * exactly, and gzip is a function of them, so holding raw catches every change
 * gzip would. (The runtime inside that script is 104 711 bytes and 32 834 gzip
 * today, Node 24 — it grew again with Z6, Z7 and Z22 after Z3, Z4 and Z5, and
 * the only number in this table that moved for any of them is the Next inline
 * row's, which does not hold the runtime either; the paragraph on that row says
 * what did move.)
 */

export const DELIVERY_BUDGETS: readonly DeliveryBudget[] = [
  {
    name: 'Astro, static build, mode: loader',
    app: 'http://localhost:4173',
    path: '/',
    carries: 'bootstrap',
    bindings: true,
    scriptElements: 1,
    overheadBytes: 762,
    // A static page has no request to decide for, so the decision moves into the
    // browser: 762 bytes that ask whether this document is framed or was opened
    // by an admin and, outside a preview, fetch nothing. This is the floor of
    // the whole table and it is not zero — a build has nobody to ask. Z8 leaves
    // it standing on purpose, which is why it is written down as a floor and not
    // as a defect.
    why: 'the floor for a page built ahead of time: the check has to travel with the page',
  },
  {
    name: 'Astro, static build, mode: inline',
    app: 'http://localhost:4182',
    path: '/',
    carries: 'runtime',
    bindings: true,
    scriptElements: 1,
    overheadBytes: 126,
    // The yardstick: 17 bytes of tag and 109 bytes of config in front of the
    // whole runtime, delivered to everyone. Nothing decides and nothing is
    // deferred, so this row measures what the other rows are avoiding —
    // 103 709 bytes today, up from 97 672 on 6 September because Z3, Z4 and Z5
    // added code. The 126 did not move, and that is the construction working:
    // this row holds the delivery, not the runtime. It is honest rather than
    // wrong: an option named `inline` promises exactly this.
    why: 'the price of deferring nothing, so every other row has something to be measured against',
  },
  {
    name: 'Astro, middleware',
    app: 'http://localhost:4183',
    path: '/',
    carries: 'nothing',
    bindings: true,
    scriptElements: 0,
    overheadBytes: 0,
    // Zero, and the only way to get zero: something ran for this request, looked
    // for preview intent, found none, and injected neither runtime nor
    // bootstrap. The row is here to keep the zero — a delivery that grows a
    // bootstrap "just to be safe" fails on this line.
    why: 'a request-time decision is the only thing that gets a public visitor to zero',
  },
  {
    name: 'Next.js, script in the root layout',
    app: 'http://localhost:4174',
    path: '/',
    carries: 'runtime',
    bindings: true,
    scriptElements: 2,
    overheadBytes: 11_702,
    // LP-8, held as a number. A root layout renders for every visitor and Next
    // middleware cannot inject into a body, so this fixture's wiring hands the
    // whole runtime to anyone who loads any page — 116 413 bytes in the element,
    // and again in the flight payload React writes underneath it, which is why
    // `scriptElements` is 2 and the response is 258 148 bytes.
    //
    // The 11 702 above the runtime are the tag, the 103-byte config statement
    // and the 11 580-byte fragment prelude this fixture asks for. That is the
    // one number in this table that has moved since 6 September, from 11 448:
    // the prelude bundles `src/fragment/`, so Z6's retry-after and refused
    // counter and Z22's array template inheritance are inside it. The runtime
    // grew by 7 165 bytes over the same days and this row did not notice, which
    // is the construction working — the budget holds the delivery, and the
    // prelude is part of the delivery.
    //
    // Z8 built the component that empties this row — `<LivePreviewScript />` in
    // the nextjs entry, which awaits the authorization verdict and renders
    // nothing at all for a request without one. What it could not do is switch
    // this fixture over: `examples/` is out of the lane's reach (docs/PRIVATE-
    // LOOP.md), and the switch is not one line — five specs frame this app's `/`
    // with no session and no intent, so the fixture needs an `authorizePreview`
    // and a mock admin that carries a token, the way the SvelteKit one does.
    // Until a maintainer makes that change this line stays the receipt, ratcheted
    // to what the delivery actually charges; the component's own proof that an
    // authorized request still gets the runtime and an anonymous one gets
    // nothing is `tests/unit/adapters/nextjs-script-component.test.ts`. When the
    // fixture flips, all four numbers here become the middleware row's —
    // `nothing`, 0, 0 — and the second script element goes with them: a flight
    // payload can only repeat what was rendered, so nothing rendered is nothing
    // repeated, and the double delivery stops being a number worth holding.
    why: 'LP-8: the one path that hands the whole runtime to the public, twice, and the one <LivePreviewScript /> empties as soon as a fixture renders it',
  },
  {
    name: 'Next.js, delivery: asset',
    app: 'http://localhost:4174',
    path: '/asset',
    carries: 'bootstrap',
    bindings: true,
    scriptElements: 2,
    overheadBytes: 696,
    // The same layout, the same shell, one option apart: 696 bytes instead of
    // 116 413. It is what an option alone can do, and it is not zero — the
    // layout still renders for everyone, so the bootstrap still ships, and Next
    // still repeats it in the flight payload. That gap between 696 and 0 is the
    // one `<LivePreviewScript />` closes, and closing it takes a component
    // rather than an option, because only a component can decline to render;
    // this row is what proves the gap is small but real.
    why: 'what a Next page can do without changing its architecture, and the 696 bytes that still remain',
  },
  {
    name: 'Nuxt, Nitro plugin, delivery: asset',
    app: 'http://localhost:4176',
    path: '/',
    carries: 'nothing',
    bindings: true,
    scriptElements: 0,
    overheadBytes: 0,
    // Configured for `delivery: 'asset'` and charging nothing anyway: the Nitro
    // plugin decides per request, and a request without intent never reaches the
    // point where a bootstrap would be written. The bootstrap is what an
    // authorized preview gets; the public gets the page it would have got
    // without this package installed.
    why: 'a per-request decision in front of an asset delivery leaves the public response untouched',
  },
  {
    name: 'SvelteKit, handle, gated bindings',
    app: 'http://localhost:4175',
    path: '/',
    carries: 'nothing',
    bindings: false,
    scriptElements: 0,
    overheadBytes: 0,
    // The strict end of the table: zero bytes and no `data-payload-*` either,
    // because `createPreviewBindings()` is keyed on the authorization verdict.
    // The attributes are a few dozen bytes each and harmless to a visitor, but
    // they describe the content model to anyone who reads the markup, and this
    // row is the one that proves they can be withheld.
    why: 'zero bytes and no content model in the markup — the most a delivery can withhold',
  },
];

export interface DeliveryViolation {
  readonly metric: 'carries' | 'bindings' | 'script elements' | 'overhead bytes';
  readonly actual: string;
  readonly reason: string;
}

/**
 * Both directions. A budget that only catches growth lets an unrecorded win
 * rot: if a delivery stops shipping bytes and nobody writes the new number
 * down, the next regression back to the old one passes.
 */
export function findDeliveryViolations(
  measurement: DeliveryMeasurement,
  budget: DeliveryBudget,
): readonly DeliveryViolation[] {
  const violations: DeliveryViolation[] = [];
  if (measurement.carries !== budget.carries) {
    violations.push({
      metric: 'carries',
      actual: measurement.carries,
      reason: `this path is written down as carrying ${budget.carries}`,
    });
  }
  if (measurement.bindings !== budget.bindings) {
    violations.push({
      metric: 'bindings',
      actual: measurement.bindings ? 'present' : 'absent',
      reason: budget.bindings
        ? 'the public markup is written down as carrying data-payload-* attributes'
        : 'the public markup is written down as carrying no data-payload-* attribute',
    });
  }
  violations.push(
    ...exactViolations(
      'script elements',
      measurement.scriptElements,
      budget.scriptElements,
      'element',
    ),
  );
  violations.push(
    ...exactViolations('overhead bytes', measurement.overheadBytes, budget.overheadBytes, 'byte'),
  );
  return violations;
}

function exactViolations(
  metric: DeliveryViolation['metric'],
  actual: number,
  budget: number,
  unit: string,
): readonly DeliveryViolation[] {
  if (actual === budget) return [];
  const direction =
    actual > budget
      ? `above the ${String(budget)} ${unit}s this path is allowed`
      : `below the ${String(budget)} ${unit}s written down — record the improvement here`;
  return [{ metric, actual: String(actual), reason: direction }];
}
