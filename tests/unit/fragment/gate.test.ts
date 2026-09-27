import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createGate } from '@fragment/gate';
import { propertyParameters } from '../property/fast-check';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

  it('removes an aborted waiter and its listener without ever running it', async () => {
    const gate = createGate(1);
    const held = deferred();
    const first = gate(() => held.promise);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const run = vi.fn(() => Promise.resolve('wrong'));

    const waiting = gate(run, controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    held.resolve();
    await first;
    expect(await gate(() => Promise.resolve('next'))).toBe('next');
  });

  it('does not enqueue an already aborted caller', async () => {
    const gate = createGate(1);
    const controller = new AbortController();
    const run = vi.fn(() => Promise.resolve('wrong'));
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    controller.abort('cancelled before enqueue');

    await expect(gate(run, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'The operation was aborted.',
    });
    expect(run).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await gate(() => Promise.resolve('next'))).toBe('next');
  });

  it('ignores an abort delivery retained by a hostile signal after its waiter ran', async () => {
    const gate = createGate(1);
    const held = deferred();
    const first = gate(() => held.promise);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const waiting = gate(() => Promise.resolve('ran'), controller.signal);
    const registered = add.mock.calls[0]?.[1];

    held.resolve();
    await first;
    await expect(waiting).resolves.toBe('ran');
    if (typeof registered === 'function') {
      registered.call(controller.signal, new Event('abort'));
    } else {
      registered?.handleEvent(new Event('abort'));
    }

    expect(await gate(() => Promise.resolve('after'))).toBe('after');
  });

  it('withdraws a waiter when a signal turns aborted during listener registration', async () => {
    const gate = createGate(1);
    const held = deferred();
    const first = gate(() => held.promise);
    const reason = new Error('aborted while registering');
    let reads = 0;
    const signal = {
      get aborted() {
        reads += 1;
        return reads > 1;
      },
      reason,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const run = vi.fn(() => Promise.resolve('wrong'));

    await expect(gate(run, signal)).rejects.toBe(reason);
    expect(run).not.toHaveBeenCalled();
    held.resolve();
    await first;
    expect(await gate(() => Promise.resolve('after'))).toBe('after');
  });

  it('removes a waiter listener when the permit is granted normally', async () => {
    const gate = createGate(1);
    const held = deferred();
    const first = gate(() => held.promise);
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const waiting = gate(() => Promise.resolve('ran'), controller.signal);

    held.resolve();
    await first;
    await expect(waiting).resolves.toBe('ran');

    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('returns a handed-off permit when the waiter aborts before its continuation runs', async () => {
    const gate = createGate(1);
    const held = deferred();
    const started: string[] = [];
    const first = gate(() => held.promise);
    const controller = new AbortController();
    const raced = gate(() => {
      started.push('aborted');
      return Promise.resolve();
    }, controller.signal);
    const trailing = gate(() => {
      started.push('trailing');
      return Promise.resolve();
    });

    held.resolve();
    queueMicrotask(() => controller.abort());

    await first;
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
    await trailing;
    expect(started).toEqual(['trailing']);
    expect(await gate(() => Promise.resolve('after'))).toBe('after');
  });

  it('does not leave a live revision behind thousands of cancelled waiters', async () => {
    const gate = createGate(1);
    const held = deferred();
    const first = gate(() => held.promise);
    const controllers = Array.from({ length: 2_000 }, () => new AbortController());
    let cancelledRuns = 0;
    const cancelled = controllers.map((controller) =>
      gate(() => {
        cancelledRuns += 1;
        return Promise.resolve();
      }, controller.signal).catch((error: unknown) => error),
    );
    for (const controller of controllers) controller.abort();
    const started: string[] = [];
    const trailing = gate(() => {
      started.push('trailing');
      return Promise.resolve();
    });

    held.resolve();
    await first;
    await trailing;
    await Promise.all(cancelled);

    expect(cancelledRuns).toBe(0);
    expect(started).toEqual(['trailing']);
  });

  it('preserves the limit and FIFO order for every non-aborted generated waiter', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
        async (limit, aborts) => {
          const gate = createGate(limit);
          const blockers = Array.from({ length: limit }, deferred);
          let active = 0;
          let peak = 0;
          const started: number[] = [];
          const first = blockers.map((held) =>
            gate(async () => {
              active += 1;
              peak = Math.max(peak, active);
              await held.promise;
              active -= 1;
            }),
          );
          const controllers = aborts.map(() => new AbortController());
          const waiting = aborts.map((_, index) =>
            gate(async () => {
              active += 1;
              peak = Math.max(peak, active);
              started.push(index);
              await Promise.resolve();
              active -= 1;
            }, controllers[index]?.signal).catch((error: unknown) => error),
          );
          aborts.forEach((abort, index) => {
            if (abort) controllers[index]?.abort();
          });

          for (const held of blockers) held.resolve();
          await Promise.all([...first, ...waiting]);

          expect(peak).toBeLessThanOrEqual(limit);
          expect(started).toEqual(aborts.flatMap((abort, index) => (abort ? [] : [index])));
        },
      ),
      propertyParameters(0x47415445, 60),
    );
  });
});
