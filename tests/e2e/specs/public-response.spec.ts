import { expect, test } from '@playwright/test';
import {
  describeDelivery,
  measureDelivery,
  publicResponse,
  runtimeArtifact,
} from '../helpers/delivery';
import {
  AUTHORIZED_NEXT_DELIVERY,
  DELIVERY_BUDGETS,
  NEXT_PREVIEW_ENTRY,
  findDeliveryViolations,
  type DeliveryBudget,
} from '../../fixtures/delivery-budgets';

/**
 * What a page costs someone who is not an editor.
 *
 * The interesting number about this package is not how large the runtime is but
 * who receives it, and that is decided by the delivery — not by the adapter.
 * Every wiring in `examples/` is requested here without a cookie, without
 * preview intent and without a session, and held against the exact bytes it
 * charged the last time somebody looked: `tests/fixtures/delivery-budgets.ts`.
 *
 * Three outcomes exist, and each row is pinned to the one its setup actually
 * produces:
 *
 * - `nothing`   — something ran per request, saw no preview intent, and
 *                 injected neither runtime nor bootstrap.
 * - `bootstrap` — a statically built page, or one whose script is rendered for
 *                 every visitor, carries the few hundred bytes that check for a
 *                 preview context. The runtime itself is never fetched.
 * - `runtime`   — the full runtime ships to everyone. Honest, and the reason
 *                 the other two options exist.
 *
 * A page that is not gated is not a defect here; being wrong about which case a
 * setup falls into, or about what it charges, would be.
 *
 * One test in the file asks with a credential rather than without one, and it is
 * the reason the zeros above it can be read as wins: a delivery that renders
 * nothing for everybody scores `nothing / 0 / 0` too. `AUTHORIZED_NEXT_DELIVERY`
 * holds what the same Next path still charges an editor, to the byte.
 */

/** The bootstrap names the runtime it defers, so a public response can be checked for not fetching it. */
const BOOTSTRAP_URL = /runtime\.[0-9a-f]{16}\.js/u;

/**
 * Registered once per row, by index rather than in a loop: the test policy
 * wants the suite's shape readable without running it (scripts/test-policy.ts).
 */
function registerDelivery(budget: DeliveryBudget): void {
  test(`a public response carries ${budget.carries} — ${budget.name}`, async ({ request }) => {
    const measurement = await measureDelivery(request, budget, await runtimeArtifact(request));
    const violations = findDeliveryViolations(measurement, budget);

    expect(
      violations.map(({ metric, actual, reason }) => `${metric} ${actual}: ${reason}`),
      `${budget.why}\nmeasured: ${describeDelivery(measurement)}`,
    ).toEqual([]);
  });
}

registerDelivery(DELIVERY_BUDGETS[0]!);
registerDelivery(DELIVERY_BUDGETS[1]!);
registerDelivery(DELIVERY_BUDGETS[2]!);
registerDelivery(DELIVERY_BUDGETS[3]!);
registerDelivery(DELIVERY_BUDGETS[4]!);
registerDelivery(DELIVERY_BUDGETS[5]!);
registerDelivery(DELIVERY_BUDGETS[6]!);

test.describe('what a public response costs', () => {
  test('the runtime a row is charged for is the runtime the row serves', async ({ request }) => {
    // `overheadBytes` is a subtraction, and a subtraction is only honest while
    // the thing subtracted is really in there exactly once. A second copy inside
    // one element would hide behind the same number.
    const artifact = await runtimeArtifact(request);
    const inline = DELIVERY_BUDGETS.filter(({ carries }) => carries === 'runtime');
    expect(inline.length, 'the table still has a row that ships the runtime').toBeGreaterThan(0);

    for (const budget of inline) {
      const { html } = await publicResponse(request, `${budget.app}${budget.path}`);
      expect(html.split(artifact).length - 1, budget.name).toBe(1);
    }
  });

  test('the same layout hands an authorized editor the whole runtime', async ({ request }) => {
    // The counter-proof. A component that returned `null` to everyone would
    // score `nothing / 0 / 0` on the row above and look like a win; this asks
    // the same path with the credential the fixture's `/preview-session` mints
    // and holds the answer to the byte, in both directions.
    const entry = await request.get(NEXT_PREVIEW_ENTRY);
    expect(entry.status(), 'the fixture minted a preview credential').toBe(200);

    const measurement = await measureDelivery(
      request,
      AUTHORIZED_NEXT_DELIVERY,
      await runtimeArtifact(request),
    );
    const violations = findDeliveryViolations(measurement, AUTHORIZED_NEXT_DELIVERY);

    expect(
      violations.map(({ metric, actual, reason }) => `${metric} ${actual}: ${reason}`),
      `${AUTHORIZED_NEXT_DELIVERY.why}\nmeasured: ${describeDelivery(measurement)}`,
    ).toEqual([]);
  });

  test('the bootstrap is a rounding error against the runtime it defers', async ({ request }) => {
    const artifact = await runtimeArtifact(request);
    const assetBudget = DELIVERY_BUDGETS[4]!;
    // Both halves as an editor gets them: the inline row is zero for the public
    // now, and comparing an option against a page that renders nothing would
    // compare the gate, not the delivery. The credential puts the two back on
    // the same footing — same fixture, same shell, one option apart.
    expect((await request.get(NEXT_PREVIEW_ENTRY)).status()).toBe(200);
    const asset = await measureDelivery(request, assetBudget, artifact);
    const inline = await measureDelivery(request, AUTHORIZED_NEXT_DELIVERY, artifact);
    const { html } = await publicResponse(request, `${assetBudget.app}${assetBudget.path}`);

    // The claim in deployment.md is "0.7 % of what the inline build costs", so
    // hold it under one per cent rather than at a byte count that moves with
    // the runtime.
    expect(asset.emittedBytes * 100).toBeLessThan(inline.emittedBytes);
    expect(BOOTSTRAP_URL.test(html), 'the bootstrap names the runtime it will fetch').toBe(true);
  });

  test('an unauthorized preview is a public response, byte for byte', async ({ request }) => {
    // Intent is not authorization (ADR 0006). The SvelteKit fixture is the
    // strict one: a request that claims to be a preview without a token bound
    // to its path gets the same bytes as a visitor who claimed nothing.
    const claimed = await publicResponse(request, 'http://localhost:4175/?preview=true');
    const plain = await publicResponse(request, 'http://localhost:4175/');

    expect(claimed.html).toBe(plain.html);
  });
});
