import { describe, expect, it, vi } from 'vitest';
import { lazyPeer, missingPeerError } from '@adapters/shared/optional-peer';

/**
 * The loader every fragment binding shares. What matters is not that it caches
 * — it is what it refuses to cache: a failed import, which would otherwise
 * answer every later request in the process from one bad start.
 */
describe('lazyPeer', () => {
  it('runs the import once and shares it with everyone who arrives meanwhile', async () => {
    const load = vi.fn(() => Promise.resolve({ ok: true }));
    const peer = lazyPeer(load);

    const [first, second] = await Promise.all([peer(), peer()]);

    expect(load).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    await peer();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed import, so installing the package needs no restart', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('not installed'))
      .mockResolvedValue('installed later');
    const peer = lazyPeer(load);

    await expect(peer()).rejects.toThrow('not installed');
    await expect(peer()).resolves.toBe('installed later');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the rejection of the attempt already in flight', async () => {
    // Two requests arrive before the import settles: both see that attempt's
    // failure, and only the next one starts a new import.
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('not installed'));
    const peer = lazyPeer(load);

    const results = await Promise.allSettled([peer(), peer()]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('missingPeerError', () => {
  it('names one package in the singular and keeps the original as the cause', () => {
    const cause = new Error("Cannot find package 'astro'");
    const error = missingPeerError(['astro'], cause);

    expect(error.message).toContain('`astro`, an optional peer');
    expect(error.message).toContain('Install it, or pass your own `render`.');
    expect(error.cause).toBe(cause);
  });

  it('names several in the plural', () => {
    const error = missingPeerError(['react', 'react-dom'], undefined);

    expect(error.message).toContain('`react` and `react-dom`, optional peers');
    expect(error.message).toContain('Install them');
  });
});
