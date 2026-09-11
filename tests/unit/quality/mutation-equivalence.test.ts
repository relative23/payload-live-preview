/**
 * The equivalence list of a mutation policy: every survivor named, every name
 * still a survivor, every entry with the text it replaced and a sentence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateMutationReport, type MutationPolicy } from '../../../scripts/mutation-policy';

type Status =
  'CompileError' | 'Ignored' | 'Killed' | 'NoCoverage' | 'RuntimeError' | 'Survived' | 'Timeout';

const SCOPE = ['src/core/cache.ts', 'src/security/csp.ts'] as const;

const policy = (overrides: Partial<MutationPolicy['baseline']> = {}): MutationPolicy => ({
  schemaVersion: 1,
  profile: 'nightly-critical',
  report: {
    schemaVersion: '1.0',
    framework: { name: 'StrykerJS', version: '9.6.1' },
    strykerConfigFile: 'stryker.config.js',
    vitestConfigFile: 'vitest.stryker.config.ts',
    testRunner: 'vitest',
    coverageAnalysis: 'perTest',
    incremental: false,
    thresholds: { high: 75, low: 70, break: 70 },
  },
  scope: SCOPE,
  baseline: {
    total: 8,
    mutationScoreMinimum: 71.4286,
    mutationScorePrecision: 4,
    noCoverageMaximum: 1,
    timeoutMaximum: 1,
    errorMaximum: 1,
    ignoredMaximum: 0,
    ...overrides,
  },
});

const report = (
  statuses: Readonly<Record<(typeof SCOPE)[number], readonly Status[]>>,
): unknown => ({
  schemaVersion: '1.0',
  framework: { name: 'StrykerJS', version: '9.6.1' },
  config: {
    configFile: 'stryker.config.js',
    mutate: [...SCOPE],
    testRunner: 'vitest',
    vitest: { configFile: 'vitest.stryker.config.ts', related: true },
    coverageAnalysis: 'perTest',
    incremental: false,
    thresholds: { high: 75, low: 70, break: 70 },
    mutator: { excludedMutations: [] },
    ignorers: [],
  },
  files: Object.fromEntries(
    Object.entries(statuses).map(([path, values]) => [
      path,
      {
        language: 'typescript',
        source: '',
        mutants: values.map((status, index) => ({ id: `${path}-${String(index)}`, status })),
      },
    ]),
  ),
});
describe('the equivalence list', () => {
  const SOURCE = [
    'function f(a) {',
    '  if (a === null) return false;',
    '  return a > 1;',
    '}',
  ].join('\n');
  interface Placed {
    readonly status: Status;
    readonly line: number;
    readonly column: number;
    readonly endColumn: number;
    readonly mutatorName: string;
    readonly replacement: string;
  }
  const placed = (mutants: readonly Placed[]): unknown => {
    const base = report({ 'src/core/cache.ts': [], 'src/security/csp.ts': [] }) as {
      files: Record<string, { source: string; mutants: unknown[] }>;
    };
    base.files['src/core/cache.ts'] = {
      source: SOURCE,
      mutants: mutants.map((mutant, index) => ({
        id: String(index),
        status: mutant.status,
        mutatorName: mutant.mutatorName,
        replacement: mutant.replacement,
        location: {
          start: { line: mutant.line, column: mutant.column },
          end: { line: mutant.line, column: mutant.endColumn },
        },
      })),
    };
    base.files['src/security/csp.ts'] = {
      source: '',
      mutants: [{ id: 'k', status: 'Killed' }],
    };
    return base;
  };
  const nullGuard: Placed = {
    status: 'Survived',
    line: 2,
    column: 7,
    endColumn: 17,
    mutatorName: 'ConditionalExpression',
    replacement: 'false',
  };
  const entry = {
    file: 'src/core/cache.ts',
    line: 2,
    column: 7,
    mutator: 'ConditionalExpression',
    original: 'a === null',
    replacement: 'false',
    why: 'the comparison on the next line throws on null and the caller catches it the same way',
  };
  const listing = (
    equivalent: readonly (typeof entry)[],
    overrides: Partial<MutationPolicy['baseline']> = {},
  ): MutationPolicy => ({
    ...policy({
      total: 2,
      mutationScoreMinimum: 50,
      noCoverageMaximum: 0,
      timeoutMaximum: 0,
      errorMaximum: 0,
      ...overrides,
    }),
    equivalent,
  });

  it('passes when every survivor is listed with the text it replaced and a sentence', () => {
    const result = evaluateMutationReport(placed([nullGuard]), listing([entry]));
    expect(result.violations).toEqual([]);
  });

  it('fails a survivor the list does not name, quoting where it is and what it did', () => {
    const result = evaluateMutationReport(placed([nullGuard]), listing([]));
    expect(result.violations).toEqual([
      '[regression] src/core/cache.ts:2:7 ConditionalExpression (a === null → false) survives without an equivalence entry',
    ]);
  });

  it('treats an uncovered mutant as a survivor that has to be listed', () => {
    const result = evaluateMutationReport(
      placed([{ ...nullGuard, status: 'NoCoverage' }]),
      listing([], { noCoverageMaximum: 1, mutationScoreMinimum: 50 }),
    );
    expect(result.violations).toEqual([
      expect.stringContaining('[regression] src/core/cache.ts:2:7 ConditionalExpression'),
    ]);
  });

  it('asks for the ratchet when a listed mutant is killed now', () => {
    const result = evaluateMutationReport(
      placed([{ ...nullGuard, status: 'Killed' }]),
      listing([entry], { mutationScoreMinimum: 100 }),
    );
    expect(result.violations).toEqual([
      '[improvement] the equivalence entry src/core/cache.ts:2:7 ConditionalExpression is killed now; drop it',
    ]);
  });

  it('refuses an entry that names no mutant, and one that quotes other code', () => {
    const moved = evaluateMutationReport(placed([nullGuard]), listing([{ ...entry, line: 3 }]));
    expect(moved.violations).toEqual([
      expect.stringContaining('survives without an equivalence entry'),
      '[stale] the equivalence entry src/core/cache.ts:3:7 ConditionalExpression names no mutant in the report',
    ]);

    const misquoted = evaluateMutationReport(
      placed([nullGuard]),
      listing([{ ...entry, original: 'a > 1' }]),
    );
    expect(misquoted.violations).toEqual([
      '[stale] the equivalence entry at src/core/cache.ts:2:7 ConditionalExpression (a === null → false) quotes "a > 1"; rerun the review',
    ]);
  });

  it('demands a sentence, not a tag', () => {
    const result = evaluateMutationReport(
      placed([nullGuard]),
      listing([{ ...entry, why: 'equivalent' }]),
    );
    expect(result.violations).toEqual([
      '[policy] the equivalence entry src/core/cache.ts:2:7 ConditionalExpression needs a sentence saying why the program does the same',
    ]);
  });

  it('changes nothing for a policy that declares no list', () => {
    const result = evaluateMutationReport(
      placed([nullGuard]),
      policy({
        total: 2,
        mutationScoreMinimum: 50,
        noCoverageMaximum: 0,
        timeoutMaximum: 0,
        errorMaximum: 0,
      }),
    );
    expect(result.violations).toEqual([]);
  });

  it('holds the checked-in core list to one sentence per entry, no entry twice', () => {
    const checkedIn = JSON.parse(
      readFileSync(resolve(process.cwd(), 'quality/mutation-policy-core.json'), 'utf8'),
    ) as MutationPolicy;
    expect(checkedIn.equivalent).toBeDefined();
    const seen = new Set<string>();
    for (const item of checkedIn.equivalent ?? []) {
      const key = `${item.file}:${String(item.line)}:${String(item.column)}:${item.mutator}:${item.replacement}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
      expect(item.why.length, key).toBeGreaterThanOrEqual(30);
      expect(checkedIn.scope, key).toContain(item.file);
    }
  });
});
