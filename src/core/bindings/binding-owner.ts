/**
 * Document ownership for bindings. A field name alone cannot identify a
 * binding on a page that previews several documents — `title` may belong to a
 * global, to shared SEO metadata and to every card at once. An owner marker
 * names the document a subtree belongs to, as a plain comparable string:
 * `global:<slug>`, `collection:<slug>`, `collection:<slug>:<id>`.
 */

/** Identity of the document an incoming message describes. */
export interface MessageDocumentIdentity {
  readonly globalSlug?: string | undefined;
  readonly collectionSlug?: string | undefined;
  /** Primary key of the edited document, when the payload carries one. */
  readonly documentId?: string | undefined;
}

/** Owner key naming one Payload global. */
export function globalOwnerKey(slug: string): string {
  return `global:${slug}`;
}

/** Owner key for a collection; without an id it claims every document of it. */
export function collectionOwnerKey(slug: string, documentId?: string): string {
  return documentId === undefined || documentId === ''
    ? `collection:${slug}`
    : `collection:${slug}:${documentId}`;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Owner keys this message may address, or `null` when it carries no usable
 * identity — the runtime treats that as fail-closed rather than guessing. A
 * marker naming an id stays unreachable while the id is unknown: an unproven
 * identity must not satisfy an exact claim.
 */
export function messageOwnerKeys(identity: MessageDocumentIdentity): readonly string[] | null {
  if (nonEmpty(identity.globalSlug)) return [globalOwnerKey(identity.globalSlug)];
  if (!nonEmpty(identity.collectionSlug)) return null;
  const collectionKey = collectionOwnerKey(identity.collectionSlug);
  return nonEmpty(identity.documentId)
    ? [collectionKey, collectionOwnerKey(identity.collectionSlug, identity.documentId)]
    : [collectionKey];
}

/** Whether a binding may receive an update addressed to `keys`; an unowned binding never may. */
export function isBindingInScope(
  owner: string | undefined,
  keys: readonly string[] | null,
): boolean {
  if (keys === null || owner === undefined) return false;
  return keys.includes(owner);
}

/** The document id Payload sends alongside the edited values; only scalars prove an identity. */
export function readDocumentId(fields: Record<string, unknown>): string | undefined {
  const id: unknown = fields['id'];
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return undefined;
}
