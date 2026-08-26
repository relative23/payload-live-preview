/**
 * Stable identity for a field value, so two messages can be compared without
 * rendering either.
 *
 * Every keystroke in the Admin ships the whole document. A page with three
 * hundred bindings therefore resolves, transforms and renders three hundred
 * values per keystroke, of which one changed. Rendering is the expensive part —
 * a rich-text field costs a Lexical render plus a sanitizer pass — so the
 * cheapest correct thing is to notice that a value is the same as the one
 * already on the page and never schedule it.
 *
 * "The same" has to mean structural equality: Payload allocates a fresh
 * object graph for every message, so reference identity would never match a
 * rich-text value and the optimisation would skip exactly nothing where it
 * matters most. JSON with sorted keys is that equality for the value shapes
 * the protocol carries, which are JSON to begin with. Anything JSON cannot
 * represent — a cycle, a BigInt inside an object — has no identity and is
 * treated as changed; the asymmetry is deliberate, since a false "equal"
 * leaves a stale binding and a false "different" merely renders once more.
 *
 * @module @core/value-identity
 */

/**
 * Serialisations longer than this are not compared. A value that large is
 * rare, and the point of the comparison is to be cheaper than the render it
 * avoids; past this size that is no longer obviously true.
 */
export const IDENTITY_SIZE_LIMIT = 64 * 1024;

/**
 * Canonical string for `value`, or `undefined` when it cannot have one.
 *
 * Primitives carry a type tag so `1` and `'1'` differ, as do `null` and
 * `undefined`, even though a text renderer would print them alike: the
 * renderer decides that, not this comparison. Inside an object the wire's own
 * JSON semantics apply — key order is ignored, `undefined` properties are
 * dropped, `NaN` becomes `null` — because that is what the message meant.
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
        json = JSON.stringify(value, sortedKeys);
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

/** JSON replacer that rewrites every plain object with its keys sorted. */
function sortedKeys(_key: string, item: unknown): unknown {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
  const source = item as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = source[key];
  return sorted;
}
