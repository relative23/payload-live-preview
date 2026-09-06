/**
 * Reads `externallyUpdatedRelationship` as an edge, not as a level. Payload's
 * panel fills the field from `useDocumentEvents().mostRecentUpdate`, a state
 * that every save of the previewed document raises and that nothing ever
 * clears, so the same event repeats in every message for the rest of the
 * session. Two questions make it news again: has the event changed since the
 * last one, and does it name a document other than the one on this page.
 */

import type {
  PayloadDocumentEventDetail,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';
import { readDocumentId } from './binding-owner';

/**
 * Whether the event names a document other than the one this message previews.
 * A message that says which document that is settles it in both directions;
 * one that does not is taken at the event's word, because the repeat is
 * already handled by the identity and one re-render costs less than a drawer
 * edit the page never shows.
 */
function namesAnotherDocument(
  event: PayloadDocumentEventDetail,
  message: PayloadLivePreviewMessage,
): boolean {
  const previewedSlug = message.globalSlug ?? message.collectionSlug;
  if (typeof previewedSlug !== 'string' || event.entitySlug !== previewedSlug) return true;
  // The same entity. A global holds one document, so the event is its own
  // save; a collection is proven different only when both ids are known and
  // differ.
  const id = readDocumentId(event);
  const previewedId = readDocumentId(message.data ?? {});
  return id !== undefined && previewedId !== undefined && id !== previewedId;
}

/** Remembers the last document event the panel sent, so its repeats are one event. */
export class RelationshipTracker {
  /**
   * Identity of the last event seen. Not `id` alone: a global's save carries
   * none, and an identity that required one would read every global save as a
   * new document.
   */
  private lastIdentity: string | undefined = undefined;

  /**
   * The edit this message brings that the page has not acted on yet: a changed
   * event about another document. `null` for a message without the field, for
   * the repeat, and for the previewed document's own save.
   */
  edit(message: PayloadLivePreviewMessage): PayloadDocumentEventDetail | null {
    const event = message.externallyUpdatedRelationship;
    if (typeof event !== 'object' || event === null) return null;
    const identity = JSON.stringify([event.entitySlug, readDocumentId(event), event.updatedAt]);
    const isNew = identity !== this.lastIdentity;
    this.lastIdentity = identity;
    return isNew && namesAnotherDocument(event, message) ? event : null;
  }
}
