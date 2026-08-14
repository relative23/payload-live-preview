/**
 * Cross-browser wrapper around the View-Transitions API.
 *
 * This utility is intentionally separate from revision-authoritative DOM writes.
 * Callers may use it only when work is allowed to finish asynchronously; renderers
 * whose completion feeds lifecycle events must mutate synchronously instead.
 * Browsers without the API fall through to immediate execution.
 *
 * @module @core/view-transitions
 */

interface ViewTransitionLike {
  readonly finished: Promise<void>;
}
type DocumentWithTransitions = Document & {
  startViewTransition?: (callback: () => void) => ViewTransitionLike;
};

/**
 * Returns `true` when the host browser supports View-Transitions.
 */
export function viewTransitionsSupported(): boolean {
  if (typeof document === 'undefined') return false;
  return typeof (document as DocumentWithTransitions).startViewTransition === 'function';
}

/**
 * Run `callback` inside a View-Transition if supported. Returns a
 * promise that resolves after the transition completes. Falls back
 * to executing the callback synchronously and resolving immediately.
 */
export async function runWithTransition(callback: () => void): Promise<void> {
  if (typeof document === 'undefined') {
    callback();
    return;
  }
  const transitionDocument = document as DocumentWithTransitions;
  if (typeof transitionDocument.startViewTransition !== 'function') {
    callback();
    return;
  }
  const transition = transitionDocument.startViewTransition(callback);
  try {
    await transition.finished;
  } catch {
    // Browsers reject `finished` when the transition is interrupted —
    // not an error, just means a later update superseded us.
  }
}
