/**
 * Cross-browser wrapper around the View-Transitions API.
 *
 * Used by structural updates (array reorder/insert/remove) so the host
 * page can animate between states without a single line of consumer
 * code. Browsers without the API fall through to immediate execution
 * — the contract `runWithTransition(callback)` is a no-op shell.
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
  if (!viewTransitionsSupported()) {
    callback();
    return;
  }
  // `startViewTransition` is non-null because of the support check above.
  const start = (document as DocumentWithTransitions).startViewTransition as (
    callback: () => void,
  ) => ViewTransitionLike;
  const transition = start.call(document, callback);
  try {
    await transition.finished;
  } catch {
    // Browsers reject `finished` when the transition is interrupted —
    // not an error, just means a later update superseded us.
  }
}
