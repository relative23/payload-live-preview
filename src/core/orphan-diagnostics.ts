/**
 * LP0201: a scalar field arrived for which the page has no binding. The usual
 * cause is a template that renders the anchor only when the field is non-empty.
 */

import { isBindingInScope } from './binding-owner';
import type { ElementCache } from './cache';

/** Document fields Payload ships in every update that nobody binds to. */
const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set([
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

export interface OrphanDiagnosticContext {
  readonly cache: ElementCache;
  readonly warned: Set<string>;
  readonly warn: (...args: unknown[]) => void;
}

export function diagnoseOrphanFields(
  context: OrphanDiagnosticContext,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  ownerKeys: readonly string[] | null | false,
): void {
  const { cache, warned, warn } = context;
  if (cache.fieldCount === 0) return;
  // With scoping on, a page that renders none of this document is normal.
  if (ownerKeys !== false && !ownsAnyBinding(cache, ownerKeys)) return;
  let localisedNames: Set<string> | undefined;
  for (const [rawName, value] of Object.entries(fields)) {
    if (warned.has(rawName) || SYSTEM_FIELD_NAMES.has(rawName)) continue;
    if (!isBindableScalar(value)) continue;
    const baseName = stripLocaleSuffix(rawName, locale);
    if (hasAddressableBinding(cache, rawName, ownerKeys)) continue;
    if (baseName !== rawName && hasAddressableBinding(cache, baseName, ownerKeys)) continue;
    localisedNames ??= localisedBindingNames(cache, ownerKeys);
    if (localisedNames.has(rawName)) continue;
    warned.add(rawName);
    warn(
      `[live-preview] LP0201: no <… data-payload-field="${baseName}"> for field "${rawName}"; ` +
        'render the anchor unconditionally so edits to an empty field have somewhere to land.',
    );
  }
}

function ownsAnyBinding(cache: ElementCache, ownerKeys: readonly string[] | null): boolean {
  for (const binding of cache.values()) {
    if (isBindingInScope(binding.owner, ownerKeys)) return true;
  }
  return false;
}

function hasAddressableBinding(
  cache: ElementCache,
  fieldName: string,
  ownerKeys: readonly string[] | null | false,
): boolean {
  const bindings = cache.get(fieldName);
  if (bindings === undefined) return false;
  if (ownerKeys === false) return true;
  return bindings.some((binding) => isBindingInScope(binding.owner, ownerKeys));
}

/** `field_locale` names an element-local locale may consume while the message locale differs. */
function localisedBindingNames(
  cache: ElementCache,
  ownerKeys: readonly string[] | null | false,
): Set<string> {
  const names = new Set<string>();
  for (const [fieldName, bindings] of cache.entries()) {
    for (const binding of bindings) {
      if (ownerKeys !== false && !isBindingInScope(binding.owner, ownerKeys)) continue;
      if (binding.locale !== undefined) names.add(`${fieldName}_${binding.locale}`);
    }
  }
  return names;
}

function isBindableScalar(value: unknown): boolean {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
}

function stripLocaleSuffix(name: string, locale: string | undefined): string {
  if (locale === undefined || locale.length === 0) return name;
  const suffix = `_${locale}`;
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}
