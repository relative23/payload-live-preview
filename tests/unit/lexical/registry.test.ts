import { describe, expect, it } from 'vitest';
import { lookup, register, registeredTypes } from '@lexical/registry';
// side-effect import so the registry is populated when this test runs
import '@lexical/render';

describe('Lexical registry', () => {
  it('lookup returns the registered renderer', () => {
    expect(typeof lookup('paragraph')).toBe('function');
    expect(typeof lookup('text')).toBe('function');
    expect(typeof lookup('upload')).toBe('function');
    expect(typeof lookup('block')).toBe('function');
  });

  it('lookup returns undefined for unknown types', () => {
    expect(lookup('definitely-not-a-node')).toBeUndefined();
  });

  it('registeredTypes contains the core node types', () => {
    const types = registeredTypes();
    for (const required of [
      'text',
      'paragraph',
      'heading',
      'list',
      'listitem',
      'link',
      'autolink',
      'quote',
      'code',
      'linebreak',
      'horizontalrule',
      'upload',
      'relationship',
      'block',
    ]) {
      expect(types).toContain(required);
    }
  });

  it('register replaces a renderer for a given type', () => {
    const original = lookup('text');
    register('text', () => '~~replaced~~');
    expect(
      lookup('text')?.(
        { type: 'text', text: 'x' },
        {
          renderChildren: () => '',
          resolveAlignment: () => undefined,
          resolveIndent: () => 0,
        },
      ),
    ).toBe('~~replaced~~');
    if (original) register('text', original);
  });
});
