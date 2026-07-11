/**
 * Shared helpers for field renderers.
 *
 * @module @field-types/utils
 */

/**
 * Coerce an unknown value to a safe display string.
 *
 * Primitives render as their natural representation. Objects render
 * as their JSON form — never as the default `[object Object]`. `null`
 * and `undefined` collapse to the empty string.
 */
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
