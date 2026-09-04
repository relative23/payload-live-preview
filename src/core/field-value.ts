/** Field-path resolution for bindings and sibling-field metadata, prototype-safe. */

const BLOCKED_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Resolve a dotted field path, preferring a `_<locale>` suffix when one is
 * active. Prototype-chain properties and pollution-prone segments never resolve.
 */
export function resolveFieldValue(
  fields: Record<string, unknown>,
  path: string,
  locale: string | undefined,
  preferLocale = false,
): unknown {
  if (preferLocale && locale !== undefined) {
    const localized = readOwn(fields, `${path}_${locale}`);
    if (localized !== undefined) return localized;
  }
  const direct = readOwn(fields, path);
  if (direct !== undefined) return direct;

  if (path.includes('.')) {
    let current: unknown = fields;
    let resolved = true;
    for (const segment of path.split('.')) {
      if (BLOCKED_KEYS.has(segment) || current === null || typeof current !== 'object') {
        resolved = false;
        break;
      }
      current = readOwn(current as Record<string, unknown>, segment);
      if (current === undefined) {
        resolved = false;
        break;
      }
    }
    if (resolved) return current;
  }

  return locale === undefined ? undefined : readOwn(fields, `${path}_${locale}`);
}

function readOwn(object: Record<string, unknown>, key: string): unknown {
  if (BLOCKED_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(object, key)) {
    return undefined;
  }
  return object[key];
}
