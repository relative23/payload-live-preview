import { describe, expect, it } from 'vitest';
import {
  collectionOwnerKey,
  globalOwnerKey,
  isBindingInScope,
  messageOwnerKeys,
  readDocumentId,
} from '@core/binding-owner';

describe('owner keys', () => {
  it('names a global by its slug', () => {
    expect(globalOwnerKey('navigation')).toBe('global:navigation');
  });

  it('names a collection with and without a document', () => {
    expect(collectionOwnerKey('services')).toBe('collection:services');
    expect(collectionOwnerKey('services', '73')).toBe('collection:services:73');
  });

  it('treats an empty document id as no document rather than an empty one', () => {
    expect(collectionOwnerKey('services', '')).toBe('collection:services');
  });
});

describe('messageOwnerKeys', () => {
  it('addresses exactly one key for a global', () => {
    expect(messageOwnerKeys({ globalSlug: 'navigation' })).toEqual(['global:navigation']);
  });

  it('prefers the global slug when a message carries both', () => {
    expect(messageOwnerKeys({ globalSlug: 'navigation', collectionSlug: 'services' })).toEqual([
      'global:navigation',
    ]);
  });

  it('addresses the collection and the exact document when the id is known', () => {
    expect(messageOwnerKeys({ collectionSlug: 'services', documentId: '73' })).toEqual([
      'collection:services',
      'collection:services:73',
    ]);
  });

  it('addresses only the collection while the document id is unknown', () => {
    expect(messageOwnerKeys({ collectionSlug: 'services' })).toEqual(['collection:services']);
  });

  it('returns null when the message names no document', () => {
    expect(messageOwnerKeys({})).toBeNull();
    expect(messageOwnerKeys({ globalSlug: '', collectionSlug: '' })).toBeNull();
    expect(messageOwnerKeys({ globalSlug: undefined })).toBeNull();
  });
});

describe('isBindingInScope', () => {
  const keys = messageOwnerKeys({ collectionSlug: 'services', documentId: '73' });

  it('accepts the collection-wide and the exact document marker', () => {
    expect(isBindingInScope('collection:services', keys)).toBe(true);
    expect(isBindingInScope('collection:services:73', keys)).toBe(true);
  });

  it('rejects a sibling document of the same collection', () => {
    expect(isBindingInScope('collection:services:74', keys)).toBe(false);
  });

  it('rejects a same-named field owned by another document', () => {
    expect(isBindingInScope('global:global-seo', keys)).toBe(false);
  });

  it('rejects an unowned binding, so ownership stays a deliberate claim', () => {
    expect(isBindingInScope(undefined, keys)).toBe(false);
  });

  it('rejects everything when the message named no document', () => {
    expect(isBindingInScope('global:navigation', null)).toBe(false);
    expect(isBindingInScope(undefined, null)).toBe(false);
  });

  it('leaves an exact document marker unreachable while the id is unproven', () => {
    const withoutId = messageOwnerKeys({ collectionSlug: 'services' });
    expect(isBindingInScope('collection:services:73', withoutId)).toBe(false);
    expect(isBindingInScope('collection:services', withoutId)).toBe(true);
  });
});

describe('readDocumentId', () => {
  it('accepts a string and a finite number primary key', () => {
    expect(readDocumentId({ id: 'abc' })).toBe('abc');
    expect(readDocumentId({ id: 73 })).toBe('73');
    expect(readDocumentId({ id: 0 })).toBe('0');
  });

  it('leaves the identity unproven for anything else', () => {
    expect(readDocumentId({})).toBeUndefined();
    expect(readDocumentId({ id: '' })).toBeUndefined();
    expect(readDocumentId({ id: null })).toBeUndefined();
    expect(readDocumentId({ id: { value: 73 } })).toBeUndefined();
    expect(readDocumentId({ id: Number.NaN })).toBeUndefined();
  });
});
