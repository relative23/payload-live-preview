/**
 * Internal no-write outcome ownership.
 *
 * Public 1.x callbacks deliberately return `void`; JavaScript implementations
 * may nevertheless return arbitrary values. Only callbacks registered through
 * this module may reserve exact `false` as a no-write sentinel. This prevents a
 * custom callback's incidental boolean result from changing lifecycle counts.
 *
 * @module @core/internal-outcome
 */

type Callback = (...args: never[]) => unknown;

const noWriteCallbacks = new WeakSet<Callback>();

/** Mark a package-owned callback whose exact `false` return means no write. */
export function markNoWriteCallback<T extends Callback>(callback: T): T {
  noWriteCallbacks.add(callback);
  return callback;
}

/** Whether `callback` owns the internal exact-false sentinel contract. */
export function usesNoWriteOutcome(callback: Callback): boolean {
  return noWriteCallbacks.has(callback);
}

/** Check a renderer object without detaching its public method at the call site. */
export function rendererUsesNoWriteOutcome(renderer: { readonly render: Callback }): boolean {
  return noWriteCallbacks.has(renderer.render);
}
