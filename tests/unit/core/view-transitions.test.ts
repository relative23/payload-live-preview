import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWithTransition, viewTransitionsSupported } from '@core/view-transitions';

const transitionDocument = document;

afterEach(() => {
  Reflect.deleteProperty(transitionDocument, 'startViewTransition');
  vi.restoreAllMocks();
});

describe('view transitions', () => {
  it('falls back synchronously when the browser has no transition API', async () => {
    const callback = vi.fn();

    expect(viewTransitionsSupported()).toBe(false);
    await runWithTransition(callback);

    expect(callback).toHaveBeenCalledOnce();
  });

  it('uses the browser transition and awaits its completion', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const callback = vi.fn();
    Reflect.set(
      transitionDocument,
      'startViewTransition',
      vi.fn((work: () => void) => {
        work();
        return { finished };
      }),
    );

    expect(viewTransitionsSupported()).toBe(true);
    const pending = runWithTransition(callback);
    expect(callback).toHaveBeenCalledOnce();

    finish();
    await expect(pending).resolves.toBeUndefined();
  });

  it('treats an interrupted transition as a completed update', async () => {
    const callback = vi.fn();
    Reflect.set(
      transitionDocument,
      'startViewTransition',
      vi.fn((work: () => void) => {
        work();
        return { finished: Promise.reject(new Error('interrupted')) };
      }),
    );

    await expect(runWithTransition(callback)).resolves.toBeUndefined();
    expect(callback).toHaveBeenCalledOnce();
  });
});
