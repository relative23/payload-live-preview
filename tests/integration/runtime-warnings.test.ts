import { describe, expect, it, vi } from 'vitest';
import { bakeConfig, TRUSTED } from './runtime-harness';

/**
 * The two things the inline runtime does on its own when nobody is watching:
 * warn about a trust setup that lets any framing site drive the preview, and
 * release the origin lock when the admin stops answering.
 */

function withReferrer(origin: string): void {
  Object.defineProperty(document, 'referrer', { value: `${origin}/admin`, configurable: true });
}

describe('bootstrapInlineRuntime — trust warnings', () => {
  it('warns LP0102 when the referrer is the only thing establishing trust', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
    withReferrer(TRUSTED);
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      additionalOrigins: [],
      disableReferrerDetection: false,
      disableLocalhostMatching: true,
    });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    expect(warn.mock.calls.flat().join(' ')).toContain('LP0102');
    api?.destroy();
  });

  it('stays quiet once an explicit origin is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    warn.mockClear();
    withReferrer(TRUSTED);
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      additionalOrigins: [TRUSTED],
      disableReferrerDetection: false,
    });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();

    expect(warn.mock.calls.flat().join(' ')).not.toContain('LP0102');
    api?.destroy();
  });
});

describe('bootstrapInlineRuntime — heartbeat', () => {
  it('releases the origin lock when the admin stops answering', async () => {
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: unknown }).__LIVE_PREVIEW_CONFIG__ = bakeConfig({
      heartbeatMs: 1_000,
    });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    const api = bootstrapInlineRuntime();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'a' } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(api?.inspect().origins.locked).toBe(TRUSTED);

    // Nothing more arrives; the heartbeat expires and the lock must not survive it,
    // or a later message from a different origin would be judged against a stale lock.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api?.inspect().origins.locked).toBeUndefined();
    api?.destroy();
  });
});
