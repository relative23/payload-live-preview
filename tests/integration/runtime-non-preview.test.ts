import { describe, expect, it } from 'vitest';
import { type BakedConfigTuple, bakeConfig } from './runtime-harness';

describe('bootstrapInlineRuntime — non-preview context', () => {
  it('returns undefined when window.top equals window (no iframe, no popener)', async () => {
    Object.defineProperty(window, 'top', { value: window, configurable: true });
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    expect(bootstrapInlineRuntime()).toBeUndefined();
    expect(window.__livePreview).toBeUndefined();
  });
});
