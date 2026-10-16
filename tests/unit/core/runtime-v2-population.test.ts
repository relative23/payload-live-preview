/**
 * An anonymized projection of the observed raw-ID shape exercises the DOM caller.
 * The fetch response is an internal unit seam, not a native browser claim.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRuntime, type RuntimeHarness } from '../../helpers/runtime';
import packets from '../../fixtures/payload-2-r4-relationship.json' with { type: 'json' };
const first = packets[0]!;
const next = packets[1]!;
let harness: RuntimeHarness | undefined;
afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
});
describe('runtime — Payload 2 population', () => {
  it('fills author.name from a credentialed GET after the actual schema-free picker packet', async () => {
    document.body.innerHTML =
      '<h1 data-payload-field="title"></h1><p data-payload-field="author.name"></p>';
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [{ id: next.data.author, name: 'Ada Fixture' }],
        }),
      ),
    );
    harness = startRuntime({
      originMatcher: (origin) => origin === first.origin,
      eventSourcePolicy: 'any',
      dataMerge: { serverURL: first.origin, depth: 1, fetchFn },
    });
    for (const packet of packets) {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: packet,
          origin: packet.origin,
          source: window.parent,
        }),
      );
    }
    await vi.waitFor(() =>
      expect(document.querySelector('[data-payload-field="author.name"]')?.textContent).toBe(
        'Ada Fixture',
      ),
    );
    expect(fetchFn.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });
});
