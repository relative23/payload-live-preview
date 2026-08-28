import { describe, expect, it, vi } from 'vitest';
import { type BakedConfigTuple, bakeConfig } from './runtime-harness';

describe('bootstrapInlineRuntime — config defaults', () => {
  it('falls back to defaults when __LIVE_PREVIEW_CONFIG__ is undefined', async () => {
    Reflect.deleteProperty(globalThis, '__LIVE_PREVIEW_CONFIG__');
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(api).toBeDefined();
    api?.destroy();
  });
  it('routes debug logs through console.debug when debug=true', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({
        debug: true,
      });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    expect(debug).toHaveBeenCalled();
    api?.destroy();
    debug.mockRestore();
  });
  it('observes a rejected console.debug thenable without aborting bootstrap', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async console unavailable'));
      },
    );
    const debug = vi.spyOn(console, 'debug').mockReturnValue({ then } as never);
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({ debug: true });
    try {
      const { bootstrapInlineRuntime } = await import('@core/runtime');
      const api = bootstrapInlineRuntime();
      await Promise.resolve();
      await Promise.resolve();

      expect(api).toBeDefined();
      expect(then).toHaveBeenCalled();
      api?.destroy();
    } finally {
      debug.mockRestore();
    }
  });
});
