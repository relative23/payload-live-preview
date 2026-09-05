/**
 * The inline build starts itself on import — `__INLINE_BUILD__` is defined by
 * the runtime bundle and by nothing else — while the client build, which
 * imports the same module, must leave that to the caller.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { type BakedConfigTuple, bakeConfig, TRUSTED } from './runtime-harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('inline build autostart', () => {
  it('starts the runtime on import when built inline', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    vi.stubGlobal('__INLINE_BUILD__', true);
    const runtime = await import('@core/runtime');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'started on import' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('p')?.textContent).toBe('started on import');
    // A second bootstrap replaces the instance the import started, and hands
    // back the handle the autostart dropped.
    runtime.bootstrapInlineRuntime()?.destroy();
  });

  it('does nothing on import without the inline define', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    await import('@core/runtime');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'must not render' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('p')?.textContent).toBe('old');
  });
});
