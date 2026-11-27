import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/session/lifecycle';
import type { FieldRenderer } from '@core/types';
import { fireMessage, flushMicrotasks } from './lifecycle-harness';

// Moved out of lifecycle-cache-refresh.test.ts, which stood at the line limit.
describe('LivePreviewRuntime — cache refresh, the element-local locale', () => {
  it('uses and retargets an element-local locale after an observed mutation', async () => {
    document.body.innerHTML =
      '<span data-payload-field="amount" data-payload-locale="de-DE">initial</span>';
    const element = document.querySelector('span');
    if (element === null) throw new Error('binding missing');
    const locales: (string | undefined)[] = [];
    const numberRenderer: FieldRenderer = {
      name: 'number',
      render(target, value, context) {
        locales.push(context.locale);
        target.element.textContent = String(value);
      },
    };
    element.setAttribute('data-payload-type', 'number');
    const runtime = new LivePreviewRuntime({
      skipUnchanged: false,
      eventSourcePolicy: 'any',
      renderers: { number: numberRenderer },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      enableVisibilityGate: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 1 } });
    await vi.advanceTimersByTimeAsync(50);
    element.setAttribute('data-payload-locale', 'fr-FR');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 2 } });
    await vi.advanceTimersByTimeAsync(50);

    expect(locales).toEqual(['de-DE', 'fr-FR']);
    runtime.destroy();
  });
});
