/**
 * 3.0 makes `subfieldCoverage: 'declared'` the default. A page that would behave
 * differently hears it once in development, while it can still choose.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

const CODE = 'LP0204';

async function run(
  overrides: Parameters<typeof makeRuntime>[0],
  ...messages: Record<string, unknown>[]
): Promise<string[]> {
  document.body.innerHTML = '<h1 data-payload-field="hero.title">Title</h1>';
  const warn = vi.fn();
  const runtime = makeRuntime({ renderers: buildBuiltinRenderers(), warn, ...overrides });
  runtime.start();
  for (const data of messages) {
    fireMessage({ type: 'payload-live-preview', data });
    await vi.advanceTimersByTimeAsync(50);
  }
  runtime.destroy();
  return warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(CODE));
}

const HERO = { hero: { title: 'Title', kicker: 'Unbound' } };

describe('LP0204', () => {
  it('names a path the default covers and no binding shows', async () => {
    expect(await run({}, HERO)).toEqual([
      '[live-preview] LP0204: no binding names "hero.kicker", and a binding elsewhere in its group ' +
        'covers it, so an edit there changes nothing on the page. 3.0 makes ' +
        "subfieldCoverage: 'declared' the default, where it refreshes the route. Set the option to choose now.",
    ]);
  });

  it('is said once', async () => {
    expect(await run({}, HERO, HERO)).toHaveLength(1);
  });

  it('stays quiet when the page chose, either way', async () => {
    expect(await run({ subfieldCoverage: 'descendant' }, HERO)).toEqual([]);
    expect(await run({ subfieldCoverage: 'declared' }, HERO)).toEqual([]);
  });

  it('stays quiet when every path has a binding', async () => {
    expect(await run({}, { hero: { title: 'Only this' } })).toEqual([]);
  });

  it('stays quiet in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(await run({}, HERO)).toEqual([]);
    vi.unstubAllEnvs();
  });
});
