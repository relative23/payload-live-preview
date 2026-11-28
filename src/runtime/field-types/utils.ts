/** Value coercion shared by the field renderers. */

/** Display string for any value: primitives as-is, objects as JSON, `null`/`undefined` as `''`. */
export function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

/** The three values every renderer treats as "clear" (docs/renderers.md, value semantics). */
export function isEmptyValue(value: unknown): value is null | undefined | '' {
  return value === null || value === undefined || value === '';
}
