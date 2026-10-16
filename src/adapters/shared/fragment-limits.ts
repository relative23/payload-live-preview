/**
 * The body cap and phase timers use the same positive-integer validation.
 * Keeping it here leaves the endpoint's transport and request lifetime together
 * while all three existing limits retain their defaults and error messages.
 */

export function positiveIntegerLimit(
  name: 'bodyBytes' | 'timeoutMs' | 'totalTimeoutMs',
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new RangeError(
      `payload-live-preview: createFragmentEndpoint() limits.${name} must be a positive integer no greater than ${String(maximum)}.`,
    );
  }
  return resolved;
}
