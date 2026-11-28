/**
 * Public renderer callbacks return `void`, but a JavaScript implementation may
 * return anything. Only callbacks marked here may reserve exact `false` as
 * "no write", so a custom renderer's incidental boolean cannot change the
 * lifecycle's applied counts.
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
