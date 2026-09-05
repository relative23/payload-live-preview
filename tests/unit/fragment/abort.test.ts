import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorMessage, linkedTimeout } from '@fragment/abort';

describe('linkedTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts with the parent, and does not call that a timeout', () => {
    const parent = new AbortController();
    const link = linkedTimeout(parent.signal, 1_000);
    expect(link.signal.aborted).toBe(false);
    parent.abort();
    expect(link.signal.aborted).toBe(true);
    expect(link.timedOut()).toBe(false);
    link.dispose();
  });

  it('aborts when the time is up, and only then reports a timeout', () => {
    vi.useFakeTimers();
    const link = linkedTimeout(new AbortController().signal, 1_000);
    vi.advanceTimersByTime(999);
    expect(link.signal.aborted).toBe(false);
    expect(link.timedOut()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(link.signal.aborted).toBe(true);
    expect(link.timedOut()).toBe(true);
    link.dispose();
  });

  it('has timedOut() set by the time an abort listener runs', () => {
    vi.useFakeTimers();
    const link = linkedTimeout(new AbortController().signal, 10);
    let seen: boolean | undefined;
    link.signal.addEventListener('abort', () => {
      seen = link.timedOut();
    });
    vi.advanceTimersByTime(10);
    expect(seen).toBe(true);
    link.dispose();
  });

  it('dispose clears the timer and lets go of the parent', () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const link = linkedTimeout(parent.signal, 10);
    link.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20);
    parent.abort();
    expect(link.signal.aborted).toBe(false);
    expect(link.timedOut()).toBe(false);
  });
});

describe('errorMessage', () => {
  it.each([
    ['an Error', new Error('boom'), 'boom'],
    ['a TypeError', new TypeError('offline'), 'offline'],
    ['a string', 'plain', 'plain'],
    ['an object', { code: 1 }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
  ] as const)('reads %s', (_label, error, expected) => {
    expect(errorMessage(error)).toBe(expected);
  });
});
