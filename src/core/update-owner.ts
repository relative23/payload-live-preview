/**
 * Resolve and enforce the document owner scope shared by every update stage.
 * Keeping the warning here makes every caller use the same fail-closed decision.
 */

import { messageOwnerKeys, readDocumentId } from './binding-owner';
import type { RuntimeDeps, RuntimeState, UpdateTransaction } from './runtime-state';
import type { OwnerScope } from './unbound-fields';

export function ownerKeysForUpdate(
  deps: RuntimeDeps,
  state: RuntimeState,
  transaction: UpdateTransaction,
  fields: Record<string, unknown>,
): OwnerScope {
  if (!deps.scopeBindingsByOwner) return false;
  const { message } = transaction;
  const keys = messageOwnerKeys({
    globalSlug: typeof message.globalSlug === 'string' ? message.globalSlug : undefined,
    collectionSlug: typeof message.collectionSlug === 'string' ? message.collectionSlug : undefined,
    documentId: readDocumentId(fields),
  });
  if (keys === null && !state.warnedUnattributableMessage) {
    state.warnedUnattributableMessage = true;
    deps.warn(
      '[live-preview] LP0202: scopeBindingsByOwner: update names no document; nothing applied',
    );
  }
  return keys;
}
