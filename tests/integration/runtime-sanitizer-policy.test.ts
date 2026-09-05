/** The inline bootstrap hands `sanitizerPolicy` to its runtime instead of setting the process default (ADR 0002). */

import { describe, expect, it, vi } from 'vitest';
import { type BakedConfigTuple, bakeConfig, TRUSTED } from './runtime-harness';

// `id` passes under compat and is stripped under strict.
const CLOBBER = '<p id="hero">t</p>';

describe('bootstrapInlineRuntime — sanitizer policy', () => {
  it('renders with the baked policy and leaves the process default alone', async () => {
    document.body.innerHTML = '<div data-payload-field="body" data-payload-type="html"></div>';
    (globalThis as { __LIVE_PREVIEW_CONFIG__?: BakedConfigTuple }).__LIVE_PREVIEW_CONFIG__ =
      bakeConfig({ sanitizerPolicy: 'compat' });
    const { bootstrapInlineRuntime } = await import('@core/runtime');
    // Same module generation as the runtime's: `vi.resetModules()` ran in beforeEach.
    const { sanitizeHtml } = await import('@security/sanitizer');
    const api = bootstrapInlineRuntime();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { body: CLOBBER } },
        origin: TRUSTED,
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    expect(document.querySelector('div')?.innerHTML).toBe(CLOBBER);
    expect(sanitizeHtml(CLOBBER)).toBe('<p>t</p>');
    api?.destroy();
  });
});
