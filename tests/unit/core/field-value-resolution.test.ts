import { describe, expect, it } from 'vitest';
import { resolveFieldValue } from '@core/lifecycle';

describe('resolveFieldValue', () => {
  it('reads top-level fields', () => {
    expect(resolveFieldValue({ a: 1 }, 'a', undefined)).toBe(1);
  });

  it('reads nested dotted paths', () => {
    expect(resolveFieldValue({ hero: { title: 'x' } }, 'hero.title', undefined)).toBe('x');
  });

  it('falls back to locale-suffixed key when present', () => {
    expect(resolveFieldValue({ title_de: 'DE' }, 'title', 'de')).toBe('DE');
  });

  it('prefers a locale-suffixed key for an explicit binding override', () => {
    expect(resolveFieldValue({ title: 'EN', title_de: 'DE' }, 'title', 'de', true)).toBe('DE');
  });

  it('falls back to a locale-suffixed top-level key for a dotted path', () => {
    expect(resolveFieldValue({ 'hero.alt_de': 'Deutsch' }, 'hero.alt', 'de')).toBe('Deutsch');
  });

  it('blocks prototype pollution keys', () => {
    expect(resolveFieldValue({}, '__proto__', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'constructor', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'a.__proto__.x', undefined)).toBeUndefined();
  });

  it('returns undefined for missing fields', () => {
    expect(resolveFieldValue({}, 'missing', undefined)).toBeUndefined();
  });

  it('returns undefined when intermediate path segment is not an object', () => {
    expect(resolveFieldValue({ a: 'x' }, 'a.b', undefined)).toBeUndefined();
  });
});
