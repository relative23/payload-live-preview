/** `RuntimeOptions.sanitizerPolicy` reaches a renderer through its `RenderContext`, and nothing else does. */

import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/session/lifecycle';
import type { FieldRenderer, RenderContext } from '@core/types';
import { TRUSTED, fireMessage } from './lifecycle-harness';

async function contextSeenBy(options: {
  readonly sanitizerPolicy?: 'compat' | 'strict';
}): Promise<RenderContext | undefined> {
  document.body.innerHTML = '<p data-payload-field="title">old</p>';
  let seen: RenderContext | undefined;
  const renderer: FieldRenderer = {
    name: 'text',
    render(_target, _value, context) {
      seen = context;
    },
  };
  const runtime = new LivePreviewRuntime({
    eventSourcePolicy: 'any',
    renderers: { text: renderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    enableVisibilityGate: false,
    ...options,
  });
  runtime.start();
  fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
  await vi.advanceTimersByTimeAsync(50);
  runtime.destroy();
  return seen;
}

describe('LivePreviewRuntime — the sanitizer policy rides in the render context', () => {
  it.each([['compat'], ['strict']] as const)('hands %s to the renderer', async (policy) => {
    expect((await contextSeenBy({ sanitizerPolicy: policy }))?.sanitizerPolicy).toBe(policy);
  });

  it("hands over the strict policy when the option is absent: the default is the runtime's own", async () => {
    expect((await contextSeenBy({}))?.sanitizerPolicy).toBe('strict');
  });
});
