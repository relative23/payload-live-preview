/**
 * The module's own suite. Until now it was only reached through its two
 * callers, which both hand it well-formed records — so the guard that steps
 * over a row that is not a record, and the lookup that tolerates a caller
 * passing no key set, were never load-bearing in a test.
 */

import { describe, expect, it } from 'vitest';
import { collectTemplateKeys, interpolateArrayTemplate } from '@core/array-template';
import { safeStringify } from '@field-types/utils';

// The stringifier both callers hand in, so the suite exercises the real pairing
// rather than a stand-in that rounds values differently.
const asText = safeStringify;

describe('collectTemplateKeys', () => {
  it('reads keys out of records and steps over everything else', () => {
    // A string row is what an array of tags looks like, a null row what a
    // half-written one looks like. `Object.keys` throws on the second and
    // invents index keys for the first, so the guard has to hold.
    const keys = collectTemplateKeys([{ name: 'a' }, 'plain', null, { role: 'b' }]);

    expect([...keys].sort()).toEqual(['name', 'role']);
  });

  it('stays empty for an array that carries no record at all', () => {
    expect([...collectTemplateKeys(['a', 'b', null])]).toEqual([]);
  });
});

describe('interpolateArrayTemplate — the keys the other rows carry', () => {
  it('writes nothing where this row lacks a key another row carries', () => {
    const keys = collectTemplateKeys([{ name: 'a', role: 'x' }, { name: 'b' }]);

    expect(
      interpolateArrayTemplate('<li>{{name}} {{role}}</li>', { name: 'b' }, 1, asText, keys),
    ).toBe('<li>b </li>');
  });

  it('keeps a placeholder no row can fill, because that one is a typo', () => {
    const keys = collectTemplateKeys([{ name: 'a' }]);

    expect(
      interpolateArrayTemplate('<li>{{name}} {{rolle}}</li>', { name: 'a' }, 0, asText, keys),
    ).toBe('<li>a {{rolle}}</li>');
  });

  it('keeps the placeholder when the caller passes no key set at all', () => {
    // The parameter is optional. A caller that omits it must get the old
    // behaviour, not a crash inside the lookup.
    expect(interpolateArrayTemplate('<li>{{name}} {{role}}</li>', { name: 'a' }, 0, asText)).toBe(
      '<li>a {{role}}</li>',
    );
  });

  it('resolves a primitive row and the index before the key set is consulted', () => {
    const keys = collectTemplateKeys([{ value: 'own' }]);

    expect(interpolateArrayTemplate('{{index}}:{{value}}', 'plain', 2, asText, keys)).toBe(
      '2:plain',
    );
  });

  it("lets a record's own index property win over the reserved token", () => {
    const keys = collectTemplateKeys([{ index: 9 }]);

    expect(interpolateArrayTemplate('{{index}}', { index: 9 }, 3, asText, keys)).toBe('9');
  });

  it('leaves the placeholder on a row that is not a record at all', () => {
    // The key set is built from the whole array, so a string row sits next to
    // records that do carry the key. Writing nothing there would swallow the
    // placeholder on a row that can never own a field.
    const keys = collectTemplateKeys([{ name: 'a' }, 'plain']);

    expect(interpolateArrayTemplate('<li>{{name}}</li>', 'plain', 1, asText, keys)).toBe(
      '<li>{{name}}</li>',
    );
  });
});
