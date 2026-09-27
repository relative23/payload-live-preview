/**
 * A semaphore: at most `limit` callers run at once, the rest queue in order.
 * Cancellation only owns the wait; a running job handles its own signal.
 */

export type Gate = <T>(run: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

interface Waiter {
  readonly resume: () => void;
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export function createGate(limit: number): Gate {
  let active = 0;
  const waiting: Waiter[] = [];
  // The permit passes straight to the next waiter; decrementing first would let
  // a caller arriving before the waiter wakes run as limit + 1.
  const release = (): void => {
    const next = waiting.shift();
    if (next === undefined) active -= 1;
    else next.resume();
  };
  return async (run, signal) => {
    if (signal !== undefined && isAborted(signal)) throw abortReason(signal);
    if (active < limit) {
      active += 1;
    } else {
      await new Promise<void>((resolve, reject) => {
        let dispose = (): void => undefined;
        const waiter: Waiter = {
          resume: () => {
            dispose();
            resolve();
          },
        };
        waiting.push(waiter);
        if (signal !== undefined) {
          const abort = (): void => {
            const index = waiting.indexOf(waiter);
            if (index === -1) return;
            waiting.splice(index, 1);
            dispose();
            reject(abortReason(signal));
          };
          dispose = (): void => {
            signal.removeEventListener('abort', abort);
          };
          signal.addEventListener('abort', abort, { once: true });
          if (isAborted(signal)) abort();
        }
      });
      // `release()` hands the permit over synchronously, but this continuation
      // runs later. Return it if cancellation won that gap.
      if (signal !== undefined && isAborted(signal)) {
        release();
        throw abortReason(signal);
      }
    }
    try {
      return await run();
    } finally {
      release();
    }
  };
}
