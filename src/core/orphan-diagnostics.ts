/**
 * LP0201: a scalar field arrived for which the page has no binding. The usual
 * cause is a template that renders the anchor only when the field is non-empty.
 *
 * Reported once per field name, because the cause is the markup rather than the
 * edit. `onUnfaithfulPatch` acts on the same fact per revision; both read the
 * addressability rules from `unbound-fields.ts`.
 */

import type { ElementCache } from './cache';
import {
  createFieldAddressability,
  ownsAnyBinding,
  stripLocaleSuffix,
  SYSTEM_FIELD_NAMES,
  type FieldAddressability,
  type OwnerScope,
} from './unbound-fields';

export interface OrphanDiagnosticContext {
  readonly cache: ElementCache;
  readonly warned: Set<string>;
  readonly warn: (...args: unknown[]) => void;
}

export function diagnoseOrphanFields(
  context: OrphanDiagnosticContext,
  fields: Readonly<Record<string, unknown>>,
  locale: string | undefined,
  ownerKeys: OwnerScope,
): void {
  const { cache } = context;
  if (cache.fieldCount === 0) return;
  // With scoping on, a page that renders none of this document is normal.
  if (ownerKeys !== false && !ownsAnyBinding(cache, ownerKeys)) return;
  const isAddressable = createFieldAddressability(cache, locale, ownerKeys);
  for (const [rawName, value] of Object.entries(fields)) {
    if (SYSTEM_FIELD_NAMES.has(rawName)) continue;
    // Only scalars: an unbound relationship or block array is a template
    // decision, not the missing anchor this code is about.
    if (isBindableScalar(value)) {
      report(context, isAddressable, rawName, locale);
      continue;
    }
    if (!isPlainObject(value) || isAddressable(rawName)) continue;
    // A group with no anchor anywhere. `admission.priceFrom` is as bindable as
    // `slug` and was reported as neither, so the report names the scalar
    // instead of staying silent about the object around it. One level only:
    // deeper the shape is a rich-text tree more often than a group, and an
    // array's missing anchor stays a template decision at every depth.
    //
    // Restrained to a group the predicate above already calls unaddressable,
    // which is what keeps this in step with `onUnfaithfulPatch`: it escalates
    // on exactly these fields, and this says the same thing more precisely.
    const group = stripLocaleSuffix(rawName, locale);
    for (const [childName, childValue] of Object.entries(value)) {
      if (!isBindableScalar(childValue) || SYSTEM_FIELD_NAMES.has(childName)) continue;
      report(context, isAddressable, `${group}.${childName}`, locale);
    }
  }
}

function report(
  context: OrphanDiagnosticContext,
  isAddressable: FieldAddressability,
  name: string,
  locale: string | undefined,
): void {
  const { warned, warn } = context;
  if (warned.has(name) || isAddressable(name)) return;
  warned.add(name);
  warn(
    `[live-preview] LP0201: no <… data-payload-field="${stripLocaleSuffix(name, locale)}"> for field "${name}"; ` +
      'render the anchor unconditionally so edits to an empty field have somewhere to land.',
  );
}

function isBindableScalar(value: unknown): boolean {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
}

/** A group, as opposed to an array or a null: the one shape worth looking into. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
