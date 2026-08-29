import { describe, expect, it } from 'vitest';
import { isKnownName, referencesIn } from '../../../scripts/docs-contracts';

/**
 * The gate that reads prose. Every other gate reads code, which is why the
 * three documentation defects found before 2.0 — a class name that matched
 * nothing, an entry that did not resolve, a diagnostic code with no home —
 * survived a green pipeline.
 */

describe('what the documentation gate collects', () => {
  it('finds the four kinds of name a reader copies verbatim', () => {
    const found = referencesIn(
      "import { x } from 'payload-live-preview/lexical'; // LP0801\n" +
        '<div class="lp-block--hero" data-payload-field="title">',
      'doc.md',
    );
    expect(found.map((r) => `${r.kind}:${r.name}`)).toEqual([
      'entry:payload-live-preview/lexical',
      'diagnostic:LP0801',
      'class:lp-block--hero',
      'attribute:data-payload-field',
    ]);
  });

  it('leaves a repository URL alone, which only looks like a specifier', () => {
    const found = referencesIn(
      'https://github.com/relative23/payload-live-preview/actions/workflows/ci.yml',
      'doc.md',
    );
    expect(found.filter((r) => r.kind === 'entry')).toEqual([]);
  });

  it('does not read `plp-` as an `lp-` class', () => {
    expect(referencesIn('/tmp/plp-final-pack-v2/x.tgz', 'doc.md')).toEqual([]);
  });
});

describe('what counts as a known name', () => {
  const emitted = new Set(['lp-block', 'lp-block-callout', 'lp-relation']);

  it('accepts a name the source composes from a base it emits', () => {
    // The renderer builds `lp-block--hero` from a `lp-block` base, so the whole
    // literal never appears in the source.
    expect(isKnownName('lp-block--hero', emitted)).toBe(true);
    expect(isKnownName('lp-block-callout--info', emitted)).toBe(true);
    expect(isKnownName('lp-relation--<slug>', emitted)).toBe(true);
  });

  it('rejects the class name 2.0 nearly shipped in its release note', () => {
    // The changeset said `lp-callout--<importance>`; the renderer emits
    // `lp-block-callout--<importance>`. CSS written from the note matched
    // nothing, and no other gate reads the note.
    expect(isKnownName('lp-callout--info', emitted)).toBe(false);
    expect(isKnownName('lp-callout--<importance>', emitted)).toBe(false);
  });

  it('rejects a neighbouring name that merely shares a prefix', () => {
    expect(isKnownName('lp-blockquote', emitted)).toBe(false);
    expect(isKnownName('lp-relations', emitted)).toBe(false);
  });
});
