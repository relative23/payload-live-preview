/**
 * LP0201: a scalar field arrived for which the page has no binding. The usual
 * cause is a template that renders the anchor only when the field is non-empty.
 *
 * Reported once per field name, because the cause is the markup rather than the
 * edit. `onUnboundChange` acts on the same fact per revision; both read the
 * addressability rules from `unbound-fields.ts`.
 */

import type { ElementCache } from './cache';
import {
  createFieldAddressability,
  ownsAnyBinding,
  stripLocaleSuffix,
  SYSTEM_FIELD_NAMES,
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
  const { cache, warned, warn } = context;
  if (cache.fieldCount === 0) return;
  // With scoping on, a page that renders none of this document is normal.
  if (ownerKeys !== false && !ownsAnyBinding(cache, ownerKeys)) return;
  const isAddressable = createFieldAddressability(cache, locale, ownerKeys);
  for (const [rawName, value] of Object.entries(fields)) {
    if (warned.has(rawName) || SYSTEM_FIELD_NAMES.has(rawName)) continue;
    // Only scalars: an unbound relationship or block array is a template
    // decision, not the missing anchor this code is about.
    if (!isBindableScalar(value)) continue;
    if (isAddressable(rawName)) continue;
    warned.add(rawName);
    warn(
      `[live-preview] LP0201: no <… data-payload-field="${stripLocaleSuffix(rawName, locale)}"> for field "${rawName}"; ` +
        'render the anchor unconditionally so edits to an empty field have somewhere to land.',
    );
  }
}

function isBindableScalar(value: unknown): boolean {
  const type = typeof value;
  return type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint';
}
