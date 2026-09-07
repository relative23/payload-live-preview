/**
 * Field-path resolution for bindings and sibling-field metadata, prototype-safe,
 * and the identity of everything one binding renders — which is the same
 * question one step later, because the siblings are part of the answer.
 */

import type { CachedElement } from './types';
import { valueIdentity } from './value-identity';

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

/**
 * The value a binding renders. A binding that names its own locale reads that
 * locale and nothing else; one that does not falls back to the message locale.
 */
export function bindingValue(
  fields: Record<string, unknown>,
  target: { readonly locale?: string | undefined },
  fieldName: string,
  fallbackLocale: string | undefined,
): unknown {
  return resolveFieldValue(
    fields,
    fieldName,
    target.locale ?? fallbackLocale,
    target.locale !== undefined,
  );
}

/** Identity of everything a binding renders: its value plus any sibling href/src/alt fields. */
export function bindingIdentity(
  target: CachedElement,
  value: unknown,
  fields: Record<string, unknown>,
  locale: string | undefined,
): string | undefined {
  const own = valueIdentity(value);
  if (own === undefined) return undefined;
  const siblings = [target.hrefField, target.srcField, target.altField];
  let combined = own;
  for (const sibling of siblings) {
    if (sibling === undefined || sibling.length === 0) continue;
    const resolved = bindingValue(fields, target, sibling, locale);
    const identity = valueIdentity(resolved);
    if (identity === undefined) return undefined;
    combined += `|${sibling}=${identity}`;
  }
  return combined;
}
