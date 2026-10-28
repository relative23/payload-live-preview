/**
 * `bindingValue`: which locale a binding reads, and when the direct value wins.
 * `bindingIdentity`: what makes two writes of one binding the same write.
 */

import { describe, expect, it } from 'vitest';
import { bindingIdentity, bindingValue } from '@core/field-value';
import type { CachedElement } from '@core/types';

describe('bindingValue', () => {
  const fields = { title: 'plain', title_de: 'deutsch', title_fr: 'français', only_de: 'nur' };
  it.each([
    ['no own locale: the direct value wins over the message locale', {}, 'de', 'title', 'plain'],
    [
      'own locale: its localized value wins over the direct one',
      { locale: 'de' },
      undefined,
      'title',
      'deutsch',
    ],
    [
      'own locale wins over a different message locale',
      { locale: 'fr' },
      'de',
      'title',
      'français',
    ],
    [
      'no own locale: the message locale is the fallback when nothing is direct',
      {},
      'de',
      'only',
      'nur',
    ],
    ['no locale anywhere: only the direct value', {}, undefined, 'only', undefined],
  ] as const)('%s', (_case, target, messageLocale, name, expected) => {
    expect(bindingValue(fields, target, name, messageLocale)).toBe(expected);
  });
});

describe('bindingIdentity', () => {
  const binding = (extra: Partial<CachedElement> = {}): CachedElement => ({
    element: document.createElement('p'),
    fieldName: 'price',
    fieldType: 'number',
    ...extra,
  });
  const fields = { price: 12.34 };

  it.each([
    ['the format', { format: 'number:0' }, { format: 'number:2' }, undefined, undefined],
    ['the own locale', { locale: 'en-GB' }, { locale: 'de-DE' }, undefined, undefined],
    ['the message locale of a binding that names none', {}, {}, 'en-GB', 'de-DE'],
  ] as const)('differs when only %s differs', (_case, before, after, beforeLocale, afterLocale) => {
    const first = bindingIdentity(binding(before), 12.34, fields, beforeLocale);
    const second = bindingIdentity(binding(after), 12.34, fields, afterLocale);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });

  it('ignores the message locale for a binding that names its own', () => {
    const target = binding({ locale: 'en-GB' });
    expect(bindingIdentity(target, 12.34, fields, 'de-DE')).toBe(
      bindingIdentity(target, 12.34, fields, 'fr-FR'),
    );
  });

  it('has none for a value without one', () => {
    expect(bindingIdentity(binding({ format: 'number:2' }), Symbol('x'), fields, 'de')).toBe(
      undefined,
    );
  });
});
