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
  it('refuses a lone surrogate in a slug or id, which no URL segment can carry', () => {
    for (const surrogate of ['\uD800', '\uDC00']) {
      expect(merger.canMerge({ globalSlug: `homepage${surrogate}`, data: {} })).toBe(false);
      expect(merger.canMerge({ collectionSlug: `posts${surrogate}`, data: { id: '42' } })).toBe(
        false,
      );
      expect(merger.canMerge({ collectionSlug: 'posts', data: { id: `42${surrogate}` } })).toBe(
        false,
      );
    }
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: '\uD83D\uDE00' } })).toBe(true);
  });
  it('accepts a slug of exactly 128 and an id of exactly 512 characters, and nothing longer', () => {
    expect(merger.canMerge({ globalSlug: 'a'.repeat(128), data: {} })).toBe(true);
    expect(merger.canMerge({ globalSlug: 'a'.repeat(129), data: {} })).toBe(false);
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: 'a'.repeat(512) } })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: 'a'.repeat(513) } })).toBe(false);
  });
  it('refuses every C0 control character and DEL, and accepts their printable neighbours', () => {
    for (const code of [0x00, 0x01, 0x1f, 0x7f]) {
      const segment = `a${String.fromCodePoint(code)}b`;
      expect(merger.canMerge({ globalSlug: segment, data: {} }), String(code)).toBe(false);
      expect(
        merger.canMerge({ collectionSlug: 'posts', data: { id: segment } }),
        String(code),
      ).toBe(false);
    }
    for (const code of [0x20, 0x7e]) {
      const segment = `a${String.fromCodePoint(code)}b`;
      expect(merger.canMerge({ globalSlug: segment, data: {} }), String(code)).toBe(true);
      expect(
        merger.canMerge({ collectionSlug: 'posts', data: { id: segment } }),
        String(code),
      ).toBe(true);
    }
  });
  it('refuses an empty collection slug rather than resolving it to /api//<id>', () => {
    expect(merger.canMerge({ collectionSlug: '', data: { id: '42' } })).toBe(false);
  });
  it('refuses an id that is a String object rather than a primitive', () => {
    expect(merger.canMerge({ collectionSlug: 'posts', data: { id: Object('42') } })).toBe(false);
  });
  it('accepts valid Unicode slugs and reserved characters inside document ids', () => {
    expect(merger.canMerge({ globalSlug: 'über-uns', data: {} })).toBe(true);
    expect(merger.canMerge({ collectionSlug: 'beiträge', data: { id: 'draft ?#% ü' } })).toBe(true);
  });
});
