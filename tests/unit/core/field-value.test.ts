/** `bindingValue`: which locale a binding reads, and when the direct value wins. */

import { describe, expect, it } from 'vitest';
import { bindingValue } from '@core/field-value';

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
