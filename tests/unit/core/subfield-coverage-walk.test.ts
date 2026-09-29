import { describe, expect, it } from 'vitest';
import {
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
