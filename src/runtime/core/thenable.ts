/**
 * Detect an invalid async result in a synchronous extension point.
 *
 * Rejected native Promises otherwise become unhandled after the caller falls
 * back synchronously. Assimilating the result through a handled Promise keeps
 * that contract violation observable only through the runtime's explicit
 * error channel.
 */
export function observeThenableResult(value: unknown): boolean {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  if (typeof (value as { readonly then?: unknown }).then !== 'function') return false;
  void Promise.resolve(value).catch(() => undefined);
  return true;
}
