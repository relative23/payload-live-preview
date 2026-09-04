import { describe, expect, it } from 'vitest';
import { createGate } from '@fragment/gate';

describe('createGate', () => {
  it('never runs more than the limit, even when a caller arrives between a release and the waiter waking', async () => {
    const gate = createGate(1);
    let active = 0;
    let peak = 0;
    const job = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      for (let turn = 0; turn < 3; turn += 1) await Promise.resolve();
      active -= 1;
    };
    // Arrivals spread over the microtask queue land in every window a
    // decrement-then-wake release would leave open.
    const jobs: Promise<void>[] = [];
    for (let i = 0; i < 12; i += 1) {
      let arrival: Promise<void> = Promise.resolve();
      for (let step = 0; step < i; step += 1) arrival = arrival.then(() => undefined);
      jobs.push(arrival.then(() => gate(job)));
    }
    await Promise.all(jobs);
    expect(peak).toBe(1);
  });

  it('starts waiters in arrival order, one per released permit', async () => {
    const gate = createGate(1);
    const started: string[] = [];
    const release: (() => void)[] = [];
    const blocked = (name: string): Promise<void> =>
      gate(
        () =>
          new Promise<void>((resolve) => {
            started.push(name);
            release.push(resolve);
          }),
      );
    const a = blocked('a');
    const b = blocked('b');
    const c = blocked('c');
    await Promise.resolve();
    expect(started).toEqual(['a']);
    release[0]?.();
    await a;
    expect(started).toEqual(['a', 'b']);
    release[1]?.();
    await b;
    expect(started).toEqual(['a', 'b', 'c']);
    release[2]?.();
    await c;
  });

  it('releases the permit after a rejection', async () => {
    const gate = createGate(1);
    await expect(gate(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate(() => Promise.resolve('next'))).toBe('next');
  });
});
