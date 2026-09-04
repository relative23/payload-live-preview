import { describe, expect, it } from 'vitest';
import { DataMerger } from '@core/data-merger';

describe('DataMerger.canMerge', () => {
  const merger = new DataMerger({ serverURL: 'https://cms.example.com' });
  it('accepts globals by slug alone', () => {
    expect(merger.canMerge({ globalSlug: 'homepage', data: {} })).toBe(true);
  });
  it('accepts collections only when the form values carry an id', () => {
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: '42' } })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: 42 } })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'posts', data: {} })).toBe(false);
  });
  it('rejects messages without any slug', () => {
    expect(merger.canMerge({ data: { id: '42' } })).toBe(false);
  });
  it('rejects unsafe or malformed collection and global slugs', () => {
    for (const slug of [
      '.',
      '..',
      '../users',
      'posts/secret',
      'posts\\secret',
      'posts?draft=true',
      'posts#fragment',
      'posts\u0000secret',
      `p${'a'.repeat(128)}`,
    ]) {
      expect(merger.canMerge({ globalSlug: slug, data: {} })).toBe(false);
      expect(merger.canMerge({ collectionSlug: slug, data: { id: '42' } })).toBe(false);
    }
  });
  it('rejects unsafe collection id path segments', () => {
    for (const id of [
      '',
      '.',
      '..',
      '../draft',
      'folder/42',
      'folder\\42',
      '\u0000',
      'a'.repeat(513),
    ]) {
      expect(merger.canMerge({ collectionSlug: 'posts', data: { id } })).toBe(false);
    }
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: Number.NaN } })).toBe(false);
    expect(
      merger.canMerge({ collectionSlug: 'posts', data: { id: Number.POSITIVE_INFINITY } }),
    ).toBe(false);
  });
  it('accepts valid Unicode slugs and reserved characters inside document ids', () => {
    expect(merger.canMerge({ globalSlug: 'über-uns', data: {} })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'beiträge', data: { id: 'draft ?#% ü' } })).toBe(true);
  });
});
