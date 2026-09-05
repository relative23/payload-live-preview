/**
 * One signal for one request: it aborts when the caller's does or when `ms`
 * pass, whichever first. `timedOut()` tells the two apart afterwards; the
 * caller checks its own signal for the other. `dispose()` runs when the
 * request settles — the timer and the parent's listener outlive it otherwise.
 */

export interface LinkedTimeout {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

export function linkedTimeout(parent: AbortSignal, ms: number): LinkedTimeout {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => {
    controller.abort();
  };
  parent.addEventListener('abort', onAbort, { once: true });
  // The flag is set before the abort so a listener on `signal` can already read it.
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
