/**
 * One lifetime for everything an accepted fragment POST starts: reading the
 * body, authorizing, computing props and rendering. It ends with the request,
 * with the total deadline or with a phase that outlives its own, and work that
 * ignores the signal still cannot start a following phase (ADR 0011, ADR 0027).
 */

export type EndpointStopReason = 'request-aborted' | 'total-timeout' | 'phase-timeout';

export class EndpointStopped extends Error {
  override readonly name = 'EndpointStopped';
}

export interface EndpointRequestScope {
  readonly signal: AbortSignal;
  readonly reason: () => EndpointStopReason | undefined;
  readonly run: <T>(work: () => T | PromiseLike<T>, phaseTimeoutMs?: number) => Promise<T>;
  readonly dispose: () => void;
}

/** One cooperative lifetime for all asynchronous work started by an accepted POST. */
export function createEndpointRequestScope(
  requestSignal: AbortSignal,
  totalTimeoutMs: number | undefined,
): EndpointRequestScope {
  const controller = new AbortController();
  const deadline = totalTimeoutMs === undefined ? undefined : performance.now() + totalTimeoutMs;
  let stopped: EndpointStopReason | undefined;
  let resolveStopped: ((reason: EndpointStopReason) => void) | undefined;
  const stoppedPromise = new Promise<EndpointStopReason>((resolve) => {
    resolveStopped = resolve;
  });
  const stop = (reason: EndpointStopReason): void => {
    if (stopped !== undefined) return;
    stopped = reason;
    controller.abort(reason);
    resolveStopped?.(reason);
  };
  const abort = (): void => {
    stop('request-aborted');
  };
  requestSignal.addEventListener('abort', abort, { once: true });
  // AbortSignal does not replay an abort that landed just before registration.
  if (requestSignal.aborted) abort();
  const totalTimer =
    totalTimeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          stop('total-timeout');
        }, totalTimeoutMs);
  const check = (): void => {
    // A long synchronous phase can finish before an overdue timer gets its turn.
    if (deadline !== undefined && performance.now() >= deadline) stop('total-timeout');
    if (stopped !== undefined) throw new EndpointStopped(stopped);
  };

  return {
    signal: controller.signal,
    reason: () => stopped,
    run: async <T>(work: () => T | PromiseLike<T>, phaseTimeoutMs?: number): Promise<T> => {
      check();
      const phaseTimer =
        phaseTimeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              stop('phase-timeout');
            }, phaseTimeoutMs);
      try {
        // The race attaches rejection handlers to both promises, including a
        // late rejection by work that ignores the cooperative signal.
        const value = await Promise.race([
          Promise.resolve().then(() => {
            check();
            return work();
          }),
          stoppedPromise.then((reason) => {
            throw new EndpointStopped(reason);
          }),
        ]);
        // Cooperative work may settle from the abort event itself. The stop
        // remains authoritative, so no following phase starts after it.
        check();
        return value;
      } catch (error) {
        check();
        throw error;
      } finally {
        if (phaseTimer !== undefined) clearTimeout(phaseTimer);
      }
    },
    dispose: () => {
      if (totalTimer !== undefined) clearTimeout(totalTimer);
      requestSignal.removeEventListener('abort', abort);
    },
  };
}
