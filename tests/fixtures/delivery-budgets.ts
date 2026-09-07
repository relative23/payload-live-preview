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
 * to ratchet. Two thirds of an authorized Next response is the runtime, twice —
 * once in the element and once escaped into the flight payload — so the total
 * moves with every byte of `src/`, exactly the coupling `overheadBytes` exists
 * to avoid. And it does not reproduce everywhere: the Nuxt dev server writes the
 * absolute checkout path into two hrefs, so its total is as long as the
 * directory this repository happens to sit in. The totals are measured and
 * printed instead.
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
    carries: 'nothing',
    bindings: true,
    scriptElements: 0,
    overheadBytes: 0,
    // LP-8, closed and held as a number. This row read `runtime / 2 / 11 702`
    // until the fixture's root layout stopped calling the synchronous
    // `livePreviewScriptProps()` and started rendering `<LivePreviewScript />`,
    // the async server component that awaits `authorizePreview` and returns
    // `null` for a request that is not a preview. A layout is handed the request
    // headers and cookies but not its URL, so intent cannot be read there and
    // `inject: 'always'` makes the hook the single gate — the stricter reading,
    // and the one this row measures.
    //
    // The second script element went with the first. Next renders the head of a
    // layout a second time into its RSC flight payload, so this row used to
    // count two; a flight payload can only repeat what was rendered, and nothing
    // rendered is nothing repeated. The double delivery is not solved here, it
    // is gone — which is why `scriptElements` fell from 2 to 0 in the same step
    // and not one step behind.
    //
    // What the delivery still charges an editor is written down too, and by the
    // same subtraction: `AUTHORIZED_NEXT_DELIVERY` below. A zero that holds for
    // everyone would be a broken adapter rather than a win, so the two rows are
    // read in one file — this one proves the public pays nothing, that one
    // proves the editor still gets the runtime, down to the 11 702 bytes of tag,
    // config statement and fragment prelude this fixture asks for.
    why: 'LP-8 closed: a component that can decline to render is the only thing that gets a Next layout to zero',
  },
  {
    name: 'Next.js, delivery: asset',
    app: 'http://localhost:4174',
    path: '/asset',
    carries: 'bootstrap',
    bindings: true,
    scriptElements: 2,
    overheadBytes: 696,
    // Deliberately left on the synchronous helper after the row above moved off
    // it, because it is the only thing that still measures what an option alone
    // can do: the same layout, the same shell, one option apart — 696 bytes
    // instead of 116 413, and not zero, because the layout renders for everyone
    // and Next repeats the bootstrap in the flight payload. The gap between 696
    // and 0 is exactly what a component buys over an option, and this row is
    // what keeps that gap measured now that the inline row has crossed it.
    why: 'what an option alone can do for a Next page, and the 696 bytes that a component is needed to remove',
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

/**
 * The counter-proof for the Next row above, and the reason that row's zero can
 * be believed.
 *
 * A delivery that renders nothing for everyone scores zero on every metric in
 * this table and is not an improvement — it is an adapter that stopped working,
 * and nothing in a table of public responses could tell the two apart. So the
 * same path is measured a second time with a credential: `/preview-session`
 * mints a signed token into a cookie, and `<LivePreviewScript />` verifies it
 * and renders the runtime it declined to render a moment earlier.
 *
 * The numbers are the ones the public row carried before LP-8 was closed, to
 * the byte: 11 702 above the runtime — 17 bytes of tag, the 103-byte config
 * statement and the 11 580-byte fragment prelude this fixture asks for — in two
 * elements, because Next writes the head of a layout into its flight payload as
 * well. Nothing about the delivery got cheaper for an editor; what changed is
 * who is charged.
 *
 * Not a row of `DELIVERY_BUDGETS`, because every row there is by definition a
 * response to a request without a cookie. This one is the opposite request, and
 * `findDeliveryViolations` reads it exactly the same way.
 */
export const AUTHORIZED_NEXT_DELIVERY: DeliveryBudget = {
  name: 'Next.js, script in the root layout, authorized editor',
  app: 'http://localhost:4174',
  path: '/',
  carries: 'runtime',
  bindings: true,
  scriptElements: 2,
  overheadBytes: 11_702,
  why: 'the same layout still hands an authorized editor the whole runtime — the zero above is a decision, not a broken adapter',
};

/** How a browser or an API context acquires the cookie the Next layout gates on. */
export const NEXT_PREVIEW_ENTRY = 'http://localhost:4174/preview-session?to=%2F';

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
