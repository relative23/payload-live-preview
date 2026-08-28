/** A semaphore: at most `limit` callers run at once, the rest queue in order. */

export type Gate = <T>(run: () => Promise<T>) => Promise<T>;

export function createGate(limit: number): Gate {
  let active = 0;
  const waiting: (() => void)[] = [];
  // The permit passes straight to the next waiter; decrementing first would let
  // a caller arriving before the waiter wakes run as limit + 1.
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next();
  };
  return async (run) => {
    if (active < limit) {
      active += 1;
    } else {
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
      });
    }
    try {
      return await run();
    } finally {
      release();
    }
  };
}
