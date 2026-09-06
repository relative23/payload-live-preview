/**
 * Whether an incoming field has somewhere on the page to land.
 *
 * Two callers ask, for different reasons: LP0201 reports a field that never
 * has an anchor, and `onUnboundChange` decides whether a revision needs the
 * whole route. They have to answer the same way, so the lookup lives here
 * rather than in either of them — the locale suffix Payload appends, the owner
 * scope, and the fact that the diff names top-level fields while a binding may
 * name a path inside one.
 */

import { isBindingInScope } from './binding-owner';
import type { ElementCache } from './cache';

/** Document fields Payload ships in every update that nobody binds to. */
export const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set([
  'id',
  '_id',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  '_status',
  'globalType',
  'collection',
  'locale',
  'localized',
]);

/** Owner keys as the update resolved them; `false` means scoping is off. */
export type OwnerScope = readonly string[] | null | false;

/** Answers for one update; the locale index behind it is built at most once. */
export type FieldAddressability = (fieldName: string) => boolean;

/**
 * `field_locale` names an element-local locale may consume while the message
 * locale differs, so those bindings are addressable under their suffixed name.
 */
function localisedBindingNames(cache: ElementCache, ownerKeys: OwnerScope): Set<string> {
  const names = new Set<string>();
  for (const [fieldName, bindings] of cache.entries()) {
    for (const binding of bindings) {
      if (ownerKeys !== false && !isBindingInScope(binding.owner, ownerKeys)) continue;
      if (binding.locale !== undefined) names.add(`${fieldName}_${binding.locale}`);
    }
  }
  return names;
}

function hasBinding(cache: ElementCache, fieldName: string, ownerKeys: OwnerScope): boolean {
  const bindings = cache.get(fieldName);
  if (bindings === undefined) return false;
  if (ownerKeys === false) return true;
  return bindings.some((binding) => isBindingInScope(binding.owner, ownerKeys));
}

/**
 * A binding on a path inside the field — `hero.eyebrow` for the field `hero` —
 * makes it addressable. The diff names top-level fields only, so without this
 * every group and array on the page would look unbound.
 */
function hasBindingBelow(cache: ElementCache, fieldName: string, ownerKeys: OwnerScope): boolean {
  const prefix = `${fieldName}.`;
  for (const [boundName, bindings] of cache.entries()) {
    if (!boundName.startsWith(prefix)) continue;
    if (ownerKeys === false) return true;
    if (bindings.some((binding) => isBindingInScope(binding.owner, ownerKeys))) return true;
  }
  return false;
}

export function stripLocaleSuffix(name: string, locale: string | undefined): string {
  if (locale === undefined || locale.length === 0) return name;
  const suffix = `_${locale}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

/** Whether any binding on the page belongs to the document this update carries. */
export function ownsAnyBinding(cache: ElementCache, ownerKeys: readonly string[] | null): boolean {
  for (const binding of cache.values()) {
    if (isBindingInScope(binding.owner, ownerKeys)) return true;
  }
  return false;
}

/**
 * The same rule for a caller that has names rather than the cache: the
 * `data-payload-field` values in a document, which is all a plugin can see
 * (`src/plugins/built-in/unbound-fields-overlay.ts`).
 *
 * It answers the first three of the four questions below — exact name, the
 * locale-stripped base, a binding on a path inside the field. The fourth needs
 * each binding's own `data-payload-locale`, which is a property of the element
 * rather than of its name, so a caller with names alone cannot ask it.
 */
export function createNameAddressability(
  boundNames: Iterable<string>,
  locale: string | undefined,
): FieldAddressability {
  const names = new Set(boundNames);
  const covers = (fieldName: string): boolean => {
    if (names.has(fieldName)) return true;
    const prefix = `${fieldName}.`;
    for (const bound of names) if (bound.startsWith(prefix)) return true;
    return false;
  };
  return (fieldName) => {
    if (covers(fieldName)) return true;
    const base = stripLocaleSuffix(fieldName, locale);
    return base !== fieldName && covers(base);
  };
}

/**
 * The predicate for one update. The localised index is built on first use:
 * most fields are answered by the two cheap lookups before it.
 */
export function createFieldAddressability(
  cache: ElementCache,
  locale: string | undefined,
  ownerKeys: OwnerScope,
): FieldAddressability {
  let localised: Set<string> | undefined;
  return (fieldName) => {
    if (hasBinding(cache, fieldName, ownerKeys)) return true;
    const base = stripLocaleSuffix(fieldName, locale);
    if (base !== fieldName && hasBinding(cache, base, ownerKeys)) return true;
    if (hasBindingBelow(cache, fieldName, ownerKeys)) return true;
    if (base !== fieldName && hasBindingBelow(cache, base, ownerKeys)) return true;
    localised ??= localisedBindingNames(cache, ownerKeys);
    return localised.has(fieldName);
  };
}
