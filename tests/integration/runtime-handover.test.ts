import { describe, expect, it, vi } from 'vitest';
import { type BakedConfigTuple, TRUSTED, bakeConfig } from './runtime-harness';

describe('bootstrapInlineRuntime — handover', () => {
  it('a second bootstrap with the same configuration keeps the instance and rescans', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const first = bootstrapInlineRuntime();
    expect(first?.configSignature).toBeTypeOf('string');
    document.body.insertAdjacentHTML('beforeend', '<p data-payload-field="lede"></p>');
    const second = bootstrapInlineRuntime();
    expect(second).toBe(first);
    expect(window.__livePreview).toBe(first);
    expect(first?.inspect().bindings.elements).toBe(2);
    first?.destroy();
  });
  it('a second bootstrap with a different configuration hands over: new instance live first, old one destroyed', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const global = globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple };
    global.__LIVE_PREVIEW_CONFIG__ = bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const first = bootstrapInlineRuntime();
    const firstSignature = first?.configSignature;

    global.__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      additionalOrigins: [TRUSTED, 'https://other.example'],
    });
    const second = bootstrapInlineRuntime();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
    expect(second?.configSignature).not.toBe(firstSignature);
    expect(window.__livePreview).toBe(second);
    expect(second?.inspect().started).toBe(true);
    expect(first?.inspect().started).toBe(false);
    expect(second?.enumerateOrigins()).toContain('https://other.example');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'after handover' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after handover');
    second?.destroy();
  });
  it('keeps an instance that predates configuration signatures and asks it to refresh', async () => {
    const refresh = vi.fn();
    const legacy = Object.freeze({
      version: '0.0.0',
      destroy: vi.fn(),
      refresh,
      enumerateOrigins: () => [],
      inspect: () => ({}) as never,
    });
    Object.defineProperty(window, '__livePreview', { value: legacy, configurable: true });
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig();
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    expect(bootstrapInlineRuntime()).toBe(legacy);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(legacy.destroy).not.toHaveBeenCalled();
  });
});
