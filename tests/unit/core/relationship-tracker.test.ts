import { describe, expect, it } from 'vitest';
import { RelationshipTracker } from '@core/relationship-tracker';
import type {
  PayloadDocumentEventDetail,
  PayloadLivePreviewMessage,
} from '@/types/payload-protocol';

/**
 * LP-1: Payload fills `externallyUpdatedRelationship` from
 * `useDocumentEvents().mostRecentUpdate`, which the previewed document's own
 * save raises and nothing ever clears. Read as an edge — same event, same
 * document, said once — it stops re-rendering the page on every keystroke.
 */

function message(
  extra: Partial<PayloadLivePreviewMessage> = {},
  event?: PayloadDocumentEventDetail,
): PayloadLivePreviewMessage {
  return {
    type: 'payload-live-preview',
    data: { title: 'a' },
    ...extra,
    ...(event === undefined ? {} : { externallyUpdatedRelationship: event }),
  };
}

const GLOBAL_SAVE: PayloadDocumentEventDetail = {
  entitySlug: 'homepage',
  operation: 'update',
  updatedAt: '2026-09-06T16:53:14.954Z',
};

describe('an event about the previewed document', () => {
  it('is no edit, however often the panel repeats it', () => {
    const tracker = new RelationshipTracker();
    const previewed = message({ globalSlug: 'homepage' }, GLOBAL_SAVE);
    // A global's save carries no id; an identity that required one would read
    // each of these as a new document.
    expect(tracker.edit(previewed)).toBeNull();
    expect(tracker.edit(previewed)).toBeNull();
  });

  it('is the same document when the collection and the id agree', () => {
    const tracker = new RelationshipTracker();
    const previewed = message(
      { collectionSlug: 'posts', data: { id: 15, title: 'a' } },
      { entitySlug: 'posts', id: 15 },
    );
    expect(tracker.edit(previewed)).toBeNull();
  });
});

describe('an event about another document', () => {
  it('is reported once, and not again while the panel repeats it', () => {
    const tracker = new RelationshipTracker();
    const drawerSave = message({ globalSlug: 'homepage' }, { entitySlug: 'authors', id: 7 });
    expect(tracker.edit(drawerSave)).toEqual({ entitySlug: 'authors', id: 7 });
    expect(tracker.edit(drawerSave)).toBeNull();
  });

  it('is reported again once the drawer saves a second time', () => {
    const tracker = new RelationshipTracker();
    const at = (updatedAt: string): PayloadLivePreviewMessage =>
      message({ globalSlug: 'homepage' }, { entitySlug: 'authors', id: 7, updatedAt });
    expect(tracker.edit(at('noon'))).not.toBeNull();
    expect(tracker.edit(at('one'))).not.toBeNull();
  });

  it('is another document when the same collection names a different id', () => {
    const tracker = new RelationshipTracker();
    const sibling = message(
      { collectionSlug: 'posts', data: { id: 15, title: 'a' } },
      { entitySlug: 'posts', id: 16 },
    );
    expect(tracker.edit(sibling)).toEqual({ entitySlug: 'posts', id: 16 });
  });

  it('takes the event at its word when the message does not say what it previews', () => {
    const tracker = new RelationshipTracker();
    expect(tracker.edit(message({}, { entitySlug: 'authors', id: 7 }))).toEqual({
      entitySlug: 'authors',
      id: 7,
    });
  });
});

describe('a message without the event', () => {
  it('is no edit, and does not make the next repeat one either', () => {
    const tracker = new RelationshipTracker();
    const drawerSave = message({ globalSlug: 'homepage' }, { entitySlug: 'authors', id: 7 });
    expect(tracker.edit(drawerSave)).not.toBeNull();
    expect(tracker.edit(message({ globalSlug: 'homepage' }))).toBeNull();
    expect(tracker.edit(drawerSave)).toBeNull();
  });

  it('reports nothing for a `null` field, which is every message before the first save', () => {
    const tracker = new RelationshipTracker();
    expect(
      tracker.edit({
        type: 'payload-live-preview',
        data: { title: 'a' },
        externallyUpdatedRelationship: null,
      }),
    ).toBeNull();
  });
});
