import { describe, expect, it } from 'vitest';
import {
  brokenLinks,
  headingSlugs,
  isKnownName,
  referencesIn,
  sizeClaimViolations,
} from '../../../scripts/docs-contracts';

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

describe('heading slugs', () => {
  it.each([
    ['## Quick start', 'quick-start'],
    ['### `pll doctor` and exit codes', 'pll-doctor-and-exit-codes'],
    [
      '## Payload 3.x: populated relationships (`serverURL`)',
      'payload-3x-populated-relationships-serverurl',
    ],
    ['# Über  Umlaute', 'über-umlaute'],
  ])('%s → %s', (heading, slug) => {
    expect(headingSlugs(`${heading}\n`).has(slug)).toBe(true);
  });

  it('does not read a comment inside a code fence as a heading', () => {
    expect(headingSlugs('```sh\n# not a heading\n```\n## Real\n')).toEqual(new Set(['real']));
  });
});

describe('links between pages', () => {
  const pages: Record<string, string> = {
    'docs/options.md': '## Every option\n',
    'docs/': '',
  };
  const target = (path: string): string | undefined => pages[path];

  it.each([
    ['a page that exists', '[options](docs/options.md)', 0],
    ['a heading that exists', '[options](docs/options.md#every-option)', 0],
    ['a directory', '[docs](docs/)', 0],
    ['an external URL', '[npm](https://www.npmjs.com/package/x)', 0],
    ['a link inside a code fence', '```md\n[gone](docs/gone.md)\n```', 0],
    ['a page that does not exist', '[gone](docs/gone.md)', 1],
    ['a heading that does not exist', '[options](docs/options.md#nope)', 1],
    ['an anchor into the same page', '## Here\n[there](#there)', 1],
    ['a reference-style definition', '[ref]: docs/gone.md', 1],
  ])('flags %s as expected', (_case, text, count) => {
    expect(brokenLinks(text, 'README.md', target)).toHaveLength(count);
  });

  it('names the file and line of a broken link', () => {
    expect(brokenLinks('\n\n[gone](docs/gone.md)', 'README.md', target)).toEqual([
      'README.md:3 link to a file that does not exist: docs/gone.md',
    ]);
  });
});

describe('the runtime size claim', () => {
  it.each([
    ['matches the budget', 'about 29 KB gzip', 29_035, 0],
    ['is within a kilobyte', 'about 28 KB gzip', 29_035, 0],
    ['is stale', 'about 21 KB gzip', 29_035, 1],
    ['is absent', 'no figure here', 29_035, 0],
  ])('%s', (_case, text, budget, count) => {
    expect(sizeClaimViolations(text, 'README.md', budget)).toHaveLength(count);
  });
});
