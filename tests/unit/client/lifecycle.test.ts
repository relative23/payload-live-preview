import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LivePreviewClient } from '@client/index';

const TRUSTED = 'https://admin.example.com';

class IdleIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

let top: PropertyDescriptor | undefined;

beforeEach(() => {
  top = Object.getOwnPropertyDescriptor(window, 'top');
  Object.defineProperty(window, 'top', {
    get: () => {
      throw new Error('cross-origin');
    },
    configurable: true,
  });
  globalThis.IntersectionObserver = IdleIntersectionObserver;
});

afterEach(() => {
  if (top !== undefined) Object.defineProperty(window, 'top', top);
});

function client(): LivePreviewClient {
  return new LivePreviewClient({ allowedOrigins: [TRUSTED], autoStart: false, heartbeatMs: 0 });
}

describe('LivePreviewClient — lifecycle', () => {
  it('start, suspend and resume are idempotent and report what actually changed', async () => {
    const c = client();
    expect(c.suspend()).toBe(false);
    expect(c.resume()).toBe(false);
    expect(c.start()).toBe(true);
    expect(c.start()).toBe(true);
    expect(c.suspend()).toBe(true);
    expect(c.suspend()).toBe(false);
    expect(c.resume()).toBe(true);
    // Already running: nothing to resume.
    expect(c.resume()).toBe(false);
    await c.destroy();
  });

  it('destroy is idempotent, shares one promise, and refuses every later transition', async () => {
    const c = client();
    c.start();
    const first = c.destroy();
    expect(c.destroy()).toBe(first);
    await first;
    expect(c.destroyed).toBe(true);
    expect(c.start()).toBe(false);
    expect(c.suspend()).toBe(false);
    expect(c.resume()).toBe(false);
    await expect(c.destroy()).resolves.toBeUndefined();
  });

  it('a destroy handler calling destroy() re-entrantly receives the same in-flight promise', async () => {
    const c = client();
    c.start();
    let inner: Promise<void> | undefined;
    c.events.on('destroy', () => {
      inner = c.destroy();
    });
    const outer = c.destroy();
    await outer;
    expect(inner).toBe(outer);
  });

  it('unuse after destroy rejects like use, while a destroy hook may still unuse during teardown', async () => {
    const c = client();
    const calls: string[] = [];
    await c.use({
      name: 'a',
      init: () => undefined,
      destroy: async () => {
        await c.unuse('b');
        calls.push('a');
      },
    });
    await c.use({
      name: 'b',
      init: () => undefined,
      destroy: () => {
        calls.push('b');
      },
    });
    await c.destroy();
    expect(calls).toEqual(['b', 'a']);
    expect(c.plugins).toEqual([]);
    await expect(c.unuse('a')).rejects.toThrow(/already destroyed/u);
    await expect(c.use({ name: 'late', init: () => undefined })).rejects.toThrow(
      /already destroyed/u,
    );
  });
});
