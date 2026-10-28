import { describe, expect, it } from 'vitest';
import {
  pathChanged,
  SUBFIELD_DEPTH_LIMIT,
  SUBFIELD_VISIT_LIMIT,
  uncoveredChangedPaths,
  type PathCoverage,
} from '@core/subfield-coverage';
import { IDENTITY_SIZE_LIMIT } from '@core/value-identity';

/**
 * ADR 0022's walk, case by case: each rule the property test holds in
 * general, pinned with the one input that decides it.
 */

function coverage(bound: readonly string[]): PathCoverage {
  const set = new Set(bound);
  return {
    covers: (path) => set.has(path),
    reachesBelow: (path) => bound.some((entry) => entry.startsWith(`${path}.`)),
  };
}

const paths = (found: readonly { path: string }[]): string[] => found.map(({ path }) => path);

describe('uncoveredChangedPaths', () => {
  it('names the changed sibling and not the covered one', () => {
    const before = { eyebrow: 'E', description: 'D' };
    const after = { eyebrow: 'E2', description: 'D2' };
    expect(paths(uncoveredChangedPaths('hero', before, after, coverage(['hero.eyebrow'])))).toEqual(
      ['hero.description'],
    );
  });

  it('reports nothing for an unchanged group or a covered root', () => {
    const value = { eyebrow: 'E', description: 'D' };
    expect(uncoveredChangedPaths('hero', value, { ...value }, coverage(['hero.eyebrow']))).toEqual(
      [],
    );
    expect(uncoveredChangedPaths('hero', value, { a: 1 }, coverage(['hero']))).toEqual([]);
  });

  it('reports a subtree nothing reaches into whole, with its value', () => {
    const after = { cta: { label: 'L', url: 'U' }, eyebrow: 'E' };
    expect(uncoveredChangedPaths('hero', undefined, after, coverage(['hero.eyebrow']))).toEqual([
      { path: 'hero.cta', value: { label: 'L', url: 'U' } },
    ]);
  });

  it('counts a change of shape as a change of the whole path', () => {
    const bound = coverage(['hero.a']);
    expect(paths(uncoveredChangedPaths('hero', [], { a: 1 }, bound))).toEqual(['hero']);
    expect(paths(uncoveredChangedPaths('hero', { a: 1 }, false, bound))).toEqual(['hero']);
    expect(paths(uncoveredChangedPaths('hero', { a: 1 }, undefined, bound))).toEqual(['hero']);
    expect(paths(uncoveredChangedPaths('hero', null, { a: 1 }, bound))).toEqual(['hero']);
  });

  it('reports a new, empty group as the group', () => {
    expect(paths(uncoveredChangedPaths('hero', undefined, {}, coverage(['hero.a'])))).toEqual([
      'hero',
    ]);
  });

  it('counts values too large for an identity as changed', () => {
    const big = (fill: string): string => fill.repeat(IDENTITY_SIZE_LIMIT + 1);
    const found = uncoveredChangedPaths(
      'hero',
      { body: big('a'), eyebrow: 'E' },
      { body: big('a'), eyebrow: 'E' },
      coverage(['hero.eyebrow']),
    );
    expect(paths(found)).toEqual(['hero.body']);
  });

  it(`stops at depth ${String(SUBFIELD_DEPTH_LIMIT)} and reports what lies below as one path`, () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < SUBFIELD_DEPTH_LIMIT + 4; i += 1) deep = { a: deep };
    const bottom = `f${'.a'.repeat(SUBFIELD_DEPTH_LIMIT + 4)}`;
    const found = uncoveredChangedPaths('f', undefined, deep, coverage([bottom]));
    expect(paths(found)).toEqual([`f${'.a'.repeat(SUBFIELD_DEPTH_LIMIT)}`]);
  });

  it(`stops after ${String(SUBFIELD_VISIT_LIMIT)} nodes and reports the rest as the parent`, () => {
    const wide = Object.fromEntries(
      Array.from({ length: SUBFIELD_VISIT_LIMIT * 2 }, (_, i) => [`k${String(i)}`, i]),
    );
    const found = paths(uncoveredChangedPaths('f', {}, wide, coverage(['f.k0'])));
    // The root and 1 023 children are visited; k0 is covered, the rest stand as `f`.
    expect(found).toHaveLength(SUBFIELD_VISIT_LIMIT - 1);
    expect(found.at(-2)).toBe(`f.k${String(SUBFIELD_VISIT_LIMIT - 2)}`);
    expect(found.at(-1)).toBe('f');
  });
});

/**
 * Population is not an edit: the admin posts an upload or a relationship as
 * its id, a merge answers with the document, and a revision rendered before the
 * answer meets the one after it.
 */
describe('a document and the id it stands for', () => {
  const MEDIA = { id: 2, alt: 'Plates', url: '/media/plates.jpg' };
  const bound = coverage(['hero.kicker']);
  const changed = (before: unknown, after: unknown): string[] =>
    paths(
      uncoveredChangedPaths(
        'hero',
        { kicker: 'K', media: before },
        { kicker: 'K2', media: after },
        bound,
      ),
    );

  it('are one value, in either direction', () => {
    expect(changed(2, MEDIA)).toEqual([]);
    expect(changed(MEDIA, 2)).toEqual([]);
    expect(changed('a1', { ...MEDIA, id: 'a1' })).toEqual([]);
  });

  it('are one value inside a polymorphic relationship and a list of them', () => {
    expect(
      changed({ relationTo: 'media', value: 2 }, { relationTo: 'media', value: MEDIA }),
    ).toEqual([]);
    expect(changed([2, 3], [MEDIA, { ...MEDIA, id: 3 }])).toEqual([]);
  });

  it('differ when the id does, or its type, or the order of a list', () => {
    expect(changed(3, MEDIA)).toEqual(['hero.media']);
    expect(changed('2', MEDIA)).toEqual(['hero.media']);
    expect(changed([3, 2], [MEDIA, { ...MEDIA, id: 3 }])).toEqual(['hero.media']);
    expect(changed(true, { ...MEDIA, id: true })).toEqual(['hero.media']);
  });

  it('differ when anything else about the shape does', () => {
    expect(changed([2], [MEDIA, MEDIA])).toEqual(['hero.media']);
    expect(changed({ value: 2 }, { value: MEDIA, extra: 1 })).toEqual(['hero.media']);
    expect(changed({ value: 2, a: 1 }, { value: MEDIA, b: 1 })).toEqual(['hero.media']);
    expect(changed([2], { 0: MEDIA })).toEqual(['hero.media']);
    expect(changed([MEDIA], [MEDIA, 2])).toEqual(['hero.media']);
    expect(
      changed({ relationTo: 'media', value: 2 }, { relationTo: 'pages', value: MEDIA }),
    ).toEqual(['hero.media']);
  });
});

describe('a document and its id, past the size an identity has', () => {
  const big = 'x'.repeat(IDENTITY_SIZE_LIMIT + 1);
  const bound = coverage(['hero.kicker']);
  const changed = (before: unknown, after: unknown): string[] =>
    paths(
      uncoveredChangedPaths(
        'hero',
        { kicker: 'K', media: before },
        { kicker: 'K2', media: after },
        bound,
      ),
    );

  it('are one value without a walk, whatever the document holds', () => {
    expect(changed(2, { id: 2, caption: big })).toEqual([]);
    expect(changed({ id: 2, caption: big }, 2)).toEqual([]);
  });

  it('count as changed where only a walk could tell, and a cycle is never walked', () => {
    expect(changed([2], [{ id: 2, caption: big }])).toEqual(['hero.media']);
    expect(changed([{ id: 2, caption: big }], [2])).toEqual(['hero.media']);
    const cyclic = (): Record<string, unknown> => {
      const node: Record<string, unknown> = { id: 'n' };
      node['self'] = node;
      return node;
    };
    expect(changed(cyclic(), cyclic())).toEqual(['hero.media']);
  });
});

describe('pathChanged', () => {
  const before = { layout: [{ heading: 'Menu' }, { note: 'Saved', media: 2 }] };

  it('compares the value at the path, not its field', () => {
    const after = { layout: [{ heading: 'Menu of the day' }, { note: 'Saved', media: 2 }] };
    expect(pathChanged('layout.1.note', before, after)).toBe(false);
    expect(pathChanged('layout.0.heading', before, after)).toBe(true);
  });

  it('counts a path that appears or goes away as changed, and population as none', () => {
    expect(pathChanged('layout.2.note', before, { layout: [{}, {}, { note: 'New' }] })).toBe(true);
    expect(pathChanged('layout.1.note', before, { layout: [{}, {}] })).toBe(true);
    const populated = { layout: [{ heading: 'Menu' }, { note: 'Saved', media: { id: 2 } }] };
    expect(pathChanged('layout.1.media', before, populated)).toBe(false);
    expect(pathChanged('layout.1.media', populated, before)).toBe(false);
  });
});
