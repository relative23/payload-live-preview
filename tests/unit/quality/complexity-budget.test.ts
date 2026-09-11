import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countDeclarations,
  countInterfaceMembers,
  countPublicDeclarations,
  findComplexityViolations,
  findFreezeViolations,
  freezeSnapshotFrom,
  freezeViolationMessage,
  measureComplexity,
  type ComplexityBudget,
} from '../../../scripts/check-complexity';

/**
 * The budget only works if it is exact: a limit with room to grow into is a
 * limit nobody notices crossing. These tests hold the two halves of that — the
 * counting is right, and the reviewed file matches what is actually there.
 */

/** The same budget with the freeze taken off: the "freeze off" cases must not depend on the committed state. */
function withoutFreeze(reviewed: ComplexityBudget): ComplexityBudget {
  return {
    schemaVersion: reviewed.schemaVersion,
    totals: reviewed.totals,
    entries: reviewed.entries,
  };
}

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

  it('counts an @internal name apart from the public ones, by the tag on the line before it', () => {
    const report = [
      '// @public',
      'export function a(): void;',
      '// @internal (undocumented)',
      'export const B = 1;',
      '// @internal',
      'export interface C {',
      '    readonly d: string;',
      '}',
      '// @public',
      'export { E }',
      'export type F = string;',
    ].join('\n');

    // `F` has no tag line of its own and is public, as API Extractor treats it.
    expect(countDeclarations(report)).toEqual({ public: 3, internal: 2 });
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

describe('the freeze after the first release candidate', () => {
  const freeze = { since: 'v2.0.0-rc.0', why: 'a release candidate takes patch changes only' };

  it('is not consulted while the budget is not frozen', async () => {
    const unfrozen = withoutFreeze(await budget());

    expect(unfrozen.frozen).toBeUndefined();
    expect(findFreezeViolations(unfrozen, undefined)).toEqual([]);
  });

  it('holds the committed budget to the snapshot taken when the freeze began', async () => {
    // Frozen since the first release candidate (ADR 0013 §6): the committed
    // limits and the committed snapshot must name the same tag and agree.
    const reviewed = await budget();
    const snapshot = JSON.parse(
      await readFile(resolve('quality/complexity-budget.frozen.json'), 'utf8'),
    ) as ReturnType<typeof freezeSnapshotFrom>;

    expect(reviewed.frozen?.since).toBe(snapshot.since);
    expect(findFreezeViolations(reviewed, snapshot)).toEqual([]);
  });

  it('accepts limits that did not move since the freeze', async () => {
    const reviewed = await budget();
    const frozen: ComplexityBudget = { ...reviewed, frozen: freeze };

    expect(findFreezeViolations(frozen, freezeSnapshotFrom(frozen))).toEqual([]);
  });

  it('refuses a raised limit, naming the tag the freeze started at', async () => {
    const reviewed = await budget();
    const snapshot = freezeSnapshotFrom({ ...reviewed, frozen: freeze });
    const raised: ComplexityBudget = {
      ...reviewed,
      frozen: freeze,
      totals: {
        ...reviewed.totals,
        diagnosticCodes: {
          limit: reviewed.totals['diagnosticCodes']!.limit + 1,
          why: 'a new code',
        },
      },
    };

    const violations = findFreezeViolations(raised, snapshot);
    expect(violations).toEqual([
      {
        metric: 'diagnosticCodes',
        limit: reviewed.totals['diagnosticCodes']!.limit + 1,
        frozenLimit: reviewed.totals['diagnosticCodes']!.limit,
      },
    ]);
    const message = freezeViolationMessage(violations[0]!, freeze);
    expect(message).toContain('v2.0.0-rc.0');
    expect(message).toContain('diagnosticCodes');
    expect(message).toMatch(/patch/u);
  });

  it('refuses a budget for an entry the freeze never saw', async () => {
    const reviewed = await budget();
    const snapshot = freezeSnapshotFrom({ ...reviewed, frozen: freeze });
    const grown: ComplexityBudget = {
      ...reviewed,
      frozen: freeze,
      entries: {
        ...reviewed.entries,
        'payload-live-preview--new.api.md': { limit: 1, why: 'a new entry is a new surface' },
      },
    };

    expect(findFreezeViolations(grown, snapshot)).toEqual([
      { metric: 'payload-live-preview--new.api.md', limit: 1, frozenLimit: undefined },
    ]);
    expect(freezeViolationMessage(findFreezeViolations(grown, snapshot)[0]!, freeze)).toContain(
      'v2.0.0-rc.0',
    );
  });

  it('lets a limit fall under the freeze', async () => {
    const reviewed = await budget();
    const snapshot = freezeSnapshotFrom({ ...reviewed, frozen: freeze });
    const lowered: ComplexityBudget = {
      ...reviewed,
      frozen: freeze,
      totals: {
        ...reviewed.totals,
        diagnosticCodes: {
          limit: reviewed.totals['diagnosticCodes']!.limit - 1,
          why: 'one code retired',
        },
      },
    };

    expect(findFreezeViolations(lowered, snapshot)).toEqual([]);
  });

  it('demands the snapshot the freeze was taken with, not one from another freeze', async () => {
    const reviewed = await budget();
    const frozen: ComplexityBudget = { ...reviewed, frozen: freeze };
    const other = freezeSnapshotFrom({ ...reviewed, frozen: { ...freeze, since: 'v2.0.0-rc.1' } });

    expect(() => findFreezeViolations(frozen, undefined)).toThrow(/--freeze/u);
    expect(() => findFreezeViolations(frozen, other)).toThrow(/v2\.0\.0-rc\.1/u);
  });

  it('snapshots only the limits, keyed the way the budget is', async () => {
    const reviewed = await budget();
    const snapshot = freezeSnapshotFrom({ ...reviewed, frozen: freeze });

    expect(snapshot.since).toBe('v2.0.0-rc.0');
    expect(Object.keys(snapshot.totals)).toEqual(Object.keys(reviewed.totals));
    expect(Object.keys(snapshot.entries)).toEqual(Object.keys(reviewed.entries));
    expect(snapshot.totals['diagnosticCodes']).toBe(reviewed.totals['diagnosticCodes']!.limit);
    expect(() => freezeSnapshotFrom(withoutFreeze(reviewed))).toThrow(/frozen/u);
  });
});
