import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { propertyParameters } from './fast-check';
import {
  SUBFIELD_DEPTH_LIMIT,
  SUBFIELD_VISIT_LIMIT,
  uncoveredChangedPaths,
  type PathCoverage,
} from '@core/subfield-coverage';

/**
 * ADR 0022's walk, against arbitrary groups and bindings: it never reports a
 * covered path, never misses a changed leaf nothing covers, reports nothing
 * for an unchanged group, and stays inside its bounds.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const key = fc.constantFrom('a', 'b', 'c', 'd');
const json: fc.Arbitrary<Json> = fc.letrec<{ node: Json }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.oneof(
      fc.string({ maxLength: 3 }),
      fc.integer({ min: 0, max: 3 }),
      fc.boolean(),
      fc.constant(null),
    ),
    fc.array(tie('node'), { maxLength: 3 }),
    fc.dictionary(key, tie('node'), { maxKeys: 4 }),
  ),
})).node;
const path = fc
  .array(key, { minLength: 1, maxLength: 4 })
  .map((segments) => `f.${segments.join('.')}`);

function coverageFor(bound: readonly string[]): PathCoverage {
  const set = new Set(bound);
  return {
    covers: (candidate) => set.has(candidate),
    reachesBelow: (candidate) => bound.some((entry) => entry.startsWith(`${candidate}.`)),
  };
}

/**
 * Every scalar leaf under `root`, with its value, the way the walk addresses
 * them. An empty container is structure, not a leaf: adding a covered child to
 * `{}` shows nothing new that is uncovered.
 */
function leaves(
  root: string,
  value: unknown,
  into = new Map<string, unknown>(),
): Map<string, unknown> {
  if (typeof value === 'object' && value !== null) {
    for (const [name, child] of Object.entries(value)) leaves(`${root}.${name}`, child, into);
  } else {
    into.set(root, value);
  }
  return into;
}

function ancestorsOrSelf(candidate: string): string[] {
  const parts = candidate.split('.');
  return parts.map((_, index) => parts.slice(0, index + 1).join('.'));
}

describe('uncoveredChangedPaths', () => {
  it('never reports a covered path or one below a covered path', () => {
    fc.assert(
      fc.property(json, json, fc.array(path, { maxLength: 4 }), (before, after, bound) => {
        const coverage = coverageFor(bound);
        for (const { path: reported } of uncoveredChangedPaths('f', before, after, coverage)) {
          for (const ancestor of ancestorsOrSelf(reported)) {
            expect(coverage.covers(ancestor)).toBe(false);
          }
        }
      }),
      propertyParameters(0x48303201, 200),
    );
  });

  it('reports every changed leaf that nothing covers, at, above or below it', () => {
    fc.assert(
      fc.property(json, json, fc.array(path, { maxLength: 4 }), (before, after, bound) => {
        const coverage = coverageFor(bound);
        const reported = new Set(
          uncoveredChangedPaths('f', before, after, coverage).map((entry) => entry.path),
        );
        const previous = leaves('f', before);
        const next = leaves('f', after);
        for (const leaf of new Set([...previous.keys(), ...next.keys()])) {
          const changed = JSON.stringify(previous.get(leaf)) !== JSON.stringify(next.get(leaf));
          const covered = ancestorsOrSelf(leaf).some((ancestor) => coverage.covers(ancestor));
          if (!changed || covered) continue;
          // A scalar replaced by a container is reported by what replaced it.
          const nearby = [...reported].some(
            (entry) => ancestorsOrSelf(leaf).includes(entry) || entry.startsWith(`${leaf}.`),
          );
          expect(nearby).toBe(true);
        }
      }),
      propertyParameters(0x48303202, 200),
    );
  });

  it('reports nothing for an unchanged group', () => {
    fc.assert(
      fc.property(json, fc.array(path, { maxLength: 4 }), (value, bound) => {
        const copy = structuredClone(value);
        expect(uncoveredChangedPaths('f', value, copy, coverageFor(bound))).toEqual([]);
      }),
      propertyParameters(0x48303203, 200),
    );
  });

  it('stays within its depth bound and reports a wide group once past the visit bound', () => {
    let deep: Json = 'leaf';
    for (let i = 0; i < SUBFIELD_DEPTH_LIMIT + 4; i += 1) deep = { a: deep };
    const deepPath = `f${'.a'.repeat(SUBFIELD_DEPTH_LIMIT + 4)}`;
    const deepReport = uncoveredChangedPaths('f', undefined, deep, coverageFor([deepPath]));
    for (const { path: reported } of deepReport) {
      expect(reported.split('.').length - 1).toBeLessThanOrEqual(SUBFIELD_DEPTH_LIMIT);
    }
    expect(deepReport).toHaveLength(1);

    const wide = Object.fromEntries(
      Array.from({ length: SUBFIELD_VISIT_LIMIT * 2 }, (_, i) => [`k${String(i)}`, i]),
    );
    const wideReport = uncoveredChangedPaths('f', {}, wide, coverageFor(['f.k0']));
    expect(wideReport.length).toBeLessThanOrEqual(SUBFIELD_VISIT_LIMIT);
    expect(wideReport.at(-1)?.path).toBe('f');
  });
});
