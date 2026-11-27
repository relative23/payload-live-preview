/**
 * After a navigation commit the runtime writes the retained document again. A framework that
 * hydrates later can write over a bound element and bind it anew, and what the runtime remembers
 * of its own last write then says nothing about what the element shows.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/session/lifecycle';
import type { RouteStrategy } from '@core/strategies/strategies';
import { fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

let runtime: LivePreviewRuntime | undefined;

afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('LivePreviewRuntime — a binding that hydration binds anew after a navigation', () => {
  // Under `skipUnchanged` the stamp of the replayed write held the fallback back as unchanged.
  it.each([
    ['every value is written', false],
    ['an unchanged value is skipped', true],
  ])('goes to the route strategy and is written again, where %s', async (_mode, skipUnchanged) => {
    document.body.innerHTML = '<h1 data-payload-field="title">published first route</h1>';
    const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('failed');
    runtime = new LivePreviewRuntime({
      eventSourcePolicy: 'any',
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      enableVisibilityGate: false,
      skipUnchanged,
      strategies: { route: { plan: () => false, refresh } },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'unsaved hydrated title' } });
    await vi.advanceTimersByTimeAsync(50);

    runtime.navigationCommit();
    await vi.advanceTimersByTimeAsync(50);
    const heading = document.querySelector('h1');
    if (heading === null) throw new Error('binding missing');
    heading.textContent = 'published hydration commit';
    heading.setAttribute('data-payload-strategy', 'route');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(150);

    expect(refresh).toHaveBeenCalledOnce();
    expect(heading.textContent).toBe('unsaved hydrated title');
  });
});
