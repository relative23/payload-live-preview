import { describe, expect, it, vi } from 'vitest';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

describe('data-payload-attribute bindings', () => {
  it('writes the value into the declared attribute', async () => {
    document.body.innerHTML =
      '<time data-payload-field="publishedAt" data-payload-attribute="datetime">x</time>';
    const runtime = makeRuntime();
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { publishedAt: '2026-07-11' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-11');
    // Content untouched — attribute bindings do not render into the element.
    expect(document.querySelector('time')?.textContent).toBe('x');
    runtime.destroy();
  });
  it('refuses unsafe attribute writes and warns', async () => {
    document.body.innerHTML =
      '<div data-payload-field="x" data-payload-attribute="onclick">x</div>';
    const warn = vi.fn();
    const runtime = makeRuntime({ warn });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'alert(1)' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('div[data-payload-field]')?.hasAttribute('onclick')).toBe(false);
    expect(warn).toHaveBeenCalled();
    runtime.destroy();
  });
});
