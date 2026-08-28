/**
 * Stable identity for a field value, so two messages can be compared without
 * rendering either — every keystroke ships the whole document, of which one
 * field changed. Equality is structural (plain, unsorted JSON): Payload
 * allocates a fresh object graph per message, so reference identity would skip
 * nothing. A value JSON cannot represent has no identity and counts as
 * changed, which is the safe direction — a false "equal" leaves a stale
 * binding, a false "different" only renders once more.
 */

/** Past this size the comparison is no longer obviously cheaper than the render it avoids. */
export const IDENTITY_SIZE_LIMIT = 64 * 1024;

/**
 * Canonical string for `value`, or `undefined` when it cannot have one.
 * Primitives carry a type tag, so `1` and `'1'` differ even though a text
 * renderer prints them alike — that is the renderer's decision, not this one.
 */
export function valueIdentity(value: unknown): string | undefined {
  switch (typeof value) {
    case 'string':
      return value.length > IDENTITY_SIZE_LIMIT ? undefined : `s:${value}`;
    case 'number':
      // Object.is semantics at the top level: NaN equals NaN, -0 is not 0.
      return `n:${Object.is(value, -0) ? '-0' : String(value)}`;
    case 'boolean':
      return `b:${value ? '1' : '0'}`;
    case 'bigint':
      return `i:${String(value)}`;
    case 'undefined':
      return 'u';
    case 'object': {
      if (value === null) return 'z';
      let json: string;
      try {
        // Throws on a cycle and on a nested BigInt; both mean "no identity".
        json = JSON.stringify(value);
      } catch {
        return undefined;
      }
      return json.length > IDENTITY_SIZE_LIMIT ? undefined : `o:${json}`;
    }
    case 'symbol':
    case 'function':
      return undefined;
  }
}
