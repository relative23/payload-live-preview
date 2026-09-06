import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countInterfaceMembers,
  countPublicDeclarations,
  findComplexityViolations,
  measureComplexity,
  type ComplexityBudget,
} from '../../../scripts/check-complexity';

/**
 * The budget only works if it is exact: a limit with room to grow into is a
 * limit nobody notices crossing. These tests hold the two halves of that — the
 * counting is right, and the reviewed file matches what is actually there.
 */

async function budget(): Promise<ComplexityBudget> {
  return JSON.parse(
    await readFile(resolve('quality/complexity-budget.json'), 'utf8'),
  ) as ComplexityBudget;
}

describe('counting the surface', () => {
  it('counts one public declaration per exported name', () => {
    const report = [
      '```ts',
      '// @public',
      'export function a(): void;',
      'export interface B {',
      '    readonly c: string;',
      '}',
      'export { D }',
      '```',
    ].join('\n');

    // The member inside the interface is not a declaration of its own.
    expect(countPublicDeclarations(report)).toBe(3);
  });

  it('counts the members of one interface, not of the file', () => {
    const source = [
      'export interface Other {',
      '  readonly ignored?: string;',
      '}',
      'export interface Options {',
      '  readonly one?: string;',
      '  /** A comment is not a member. */',
      '  readonly two: number;',
      '  readonly nested?: { readonly deep?: string };',
      '}',
    ].join('\n');

    expect(countInterfaceMembers(source, 'Options')).toBe(3);
  });

  it('says which interface it could not find, rather than reporting zero', () => {
    expect(() => countInterfaceMembers('export interface A {}', 'Missing')).toThrow(/Missing/u);
  });
});

describe('the reviewed budget', () => {
  it('matches the surface exactly, with no headroom anywhere', async () => {
    const reviewed = await budget();
    const measurement = await measureComplexity();

    expect(findComplexityViolations(measurement, reviewed)).toEqual([]);
    for (const [metric, actual] of Object.entries(measurement.totals)) {
      // Exact, not "at most": a count is stable, so headroom would only be
      // room to grow into without writing down why.
      expect(reviewed.totals[metric]?.limit, metric).toBe(actual);
    }
    for (const [file, actual] of Object.entries(measurement.entries)) {
      expect(reviewed.entries[file]?.limit, file).toBe(actual);
    }
  });

  it('gives every number a reason a reader can use', async () => {
    const reviewed = await budget();

    for (const [metric, entry] of Object.entries({
      ...reviewed.totals,
      ...reviewed.entries,
    })) {
      expect(entry.why.length, metric).toBeGreaterThan(30);
    }
  });

  it('fails on growth, and on a budget for something that is gone', async () => {
    const reviewed = await budget();
    const measurement = await measureComplexity();

    const grown = {
      ...measurement,
      totals: {
        ...measurement.totals,
        diagnosticCodes: measurement.totals['diagnosticCodes']! + 1,
      },
    };
    expect(findComplexityViolations(grown, reviewed)).toEqual([
      {
        metric: 'diagnosticCodes',
        actual: measurement.totals['diagnosticCodes']! + 1,
        limit: reviewed.totals['diagnosticCodes']!.limit,
      },
    ]);

    const stale: ComplexityBudget = {
      ...reviewed,
      entries: { ...reviewed.entries, 'payload-live-preview--gone.api.md': { limit: 1, why: 'x' } },
    };
    expect(findComplexityViolations(measurement, stale)).toEqual([
      {
        metric: 'payload-live-preview--gone.api.md (budget without an API report)',
        actual: 0,
        limit: 0,
      },
    ]);
  });

  it('refuses a metric nobody reviewed', async () => {
    const measurement = await measureComplexity();

    const violations = findComplexityViolations(measurement, {
      schemaVersion: 1,
      totals: {},
      entries: {},
    });

    expect(violations.some((entry) => entry.metric.includes('no reviewed budget'))).toBe(true);
  });
});
