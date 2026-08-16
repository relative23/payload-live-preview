/**
 * Document ownership for bindings.
 *
 * A field name alone cannot identify a binding on a page that previews more
 * than one document. `title` may belong to the page global, to shared SEO
 * metadata, and to every card of a collection at the same time, and an update
 * for any one of them would otherwise reach all three.
 *
 * An owner marker names the document a subtree belongs to. Payload already
 * sends the identity of the edited document on every message, so scoping needs
 * no additional consumer configuration beyond the markers themselves.
 *
 * The grammar is deliberately small and comparable as a plain string:
 *
 *   - `global:<slug>`
 *   - `collection:<slug>`
 *   - `collection:<slug>:<id>`
 *
 * @module @core/binding-owner
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

/**
 * Owner key naming a collection, optionally narrowed to one document.
 *
 * A marker without an id claims every document of that collection, which is
 * the right granularity for a page that renders exactly one of them.
 */
export function collectionOwnerKey(slug: string, documentId?: string): string {
  return documentId === undefined || documentId === ''
    ? `collection:${slug}`
    : `collection:${slug}:${documentId}`;
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Owner keys the given message is allowed to address.
 *
 * Returns `null` when the message carries no usable document identity. That is
 * not the same as "addresses nothing": the caller decides, and the runtime
 * treats it as fail-closed rather than guessing an owner.
 *
 * A collection message addresses both the collection-wide key and — when the
 * document id is known — its exact document key. A marker that names an id is
 * therefore unreachable while the id is unknown, which is intentional: an
 * unproven identity must not satisfy an exact claim.
 */
export function messageOwnerKeys(identity: MessageDocumentIdentity): readonly string[] | null {
  if (nonEmpty(identity.globalSlug)) return [globalOwnerKey(identity.globalSlug)];
  if (!nonEmpty(identity.collectionSlug)) return null;
  const collectionKey = collectionOwnerKey(identity.collectionSlug);
  return nonEmpty(identity.documentId)
    ? [collectionKey, collectionOwnerKey(identity.collectionSlug, identity.documentId)]
    : [collectionKey];
}

/**
 * Whether a binding may receive an update addressed to `keys`.
 *
 * An unowned binding is out of scope whenever scoping is active. Ownership is
 * opt-in precisely so that this stays a deliberate, verifiable claim rather
 * than a default that silently downgrades to "matches everything".
 */
export function isBindingInScope(
  owner: string | undefined,
  keys: readonly string[] | null,
): boolean {
  if (keys === null || owner === undefined) return false;
  return keys.includes(owner);
}

/**
 * Read a document id out of an already-resolved field payload.
 *
 * Payload sends the primary key alongside the edited values. Only scalars are
 * accepted; anything else leaves the identity unproven.
 */
export function readDocumentId(fields: Record<string, unknown>): string | undefined {
  const id: unknown = fields['id'];
  if (typeof id === 'string' && id.length > 0) return id;
  if (typeof id === 'number' && Number.isFinite(id)) return String(id);
  return undefined;
}
