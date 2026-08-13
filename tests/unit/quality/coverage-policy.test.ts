import { describe, expect, it } from 'vitest';
import {
  addUntrackedChangedLines,
  COVERAGE_POLICY,
  evaluateDiffCoverage,
  findCoveragePolicyRegressions,
  matchesPolicyGlob,
  parseChangedLines,
  parseLcov,
  type CoveragePolicy,
} from '../../../scripts/coverage-policy';

const clonePolicy = (): CoveragePolicy =>
  JSON.parse(JSON.stringify(COVERAGE_POLICY)) as CoveragePolicy;

describe('coverage policy', () => {
  it('parses only added-line ranges from a zero-context Git diff', () => {
    const diff = [
      'diff --git a/src/core/cache.ts b/src/core/cache.ts',
      '--- a/src/core/cache.ts',
      '+++ b/src/core/cache.ts',
      '@@ -10,2 +10,3 @@',
      '-old ten',
      '-old eleven',
      '+new ten',
      '+new eleven',
      '+new twelve',
      '@@ -40 +41,0 @@',
      '-deleted',
      'diff --git a/src/security/csp.ts b/src/security/csp.ts',
      '--- a/src/security/csp.ts',
      '+++ b/src/security/csp.ts',
      '@@ -2 +2 @@',
      '-old csp',
      '+new csp',
    ].join('\n');

    expect([...parseChangedLines(diff)]).toEqual([
      ['src/core/cache.ts', new Set([10, 11, 12])],
      ['src/security/csp.ts', new Set([2])],
    ]);
  });

  it('adds every line from untracked source files to changed coverage', () => {
    expect([
      ...addUntrackedChangedLines(
        new Map([['src/core/cache.ts', new Set([4])]]),
        new Map([
          ['src/core/cache.ts', 2],
          ['src/core/new-file.ts', 3],
        ]),
      ),
    ]).toEqual([
      ['src/core/cache.ts', new Set([4, 1, 2])],
      ['src/core/new-file.ts', new Set([1, 2, 3])],
    ]);
  });

  it('attributes renamed additions to the new path and ignores deleted files', () => {
    const diff = [
      'diff --git a/src/core/old.ts b/src/core/new.ts',
      'similarity index 80%',
      'rename from src/core/old.ts',
      'rename to src/core/new.ts',
      '--- a/src/core/old.ts',
      '+++ b/src/core/new.ts',
      '@@ -2 +2,2 @@',
      ' unchanged',
      '+added',
      'diff --git a/src/core/deleted.ts b/src/core/deleted.ts',
      'deleted file mode 100644',
      '--- a/src/core/deleted.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-deleted',
    ].join('\n');

    expect([...parseChangedLines(diff)]).toEqual([['src/core/new.ts', new Set([3])]]);
  });

  it('enforces aggregate changed-line and stricter critical changed-line budgets', () => {
    const lcov = parseLcov(`
SF:src/core/cache.ts
${Array.from({ length: 20 }, (_, index) => `DA:${String(index + 1)},${index === 19 ? '0' : '1'}`).join('\n')}
end_of_record
SF:src/core/runtime.ts
${Array.from({ length: 10 }, (_, index) => `DA:${String(index + 1)},${index === 9 ? '0' : '1'}`).join('\n')}
end_of_record
`);
    const changed = new Map([
      ['src/core/cache.ts', new Set(Array.from({ length: 20 }, (_, index) => index + 1))],
      ['src/core/runtime.ts', new Set(Array.from({ length: 10 }, (_, index) => index + 1))],
    ]);

    const passing = evaluateDiffCoverage(lcov, changed);
    expect(passing.percentage).toBeCloseTo(93.33, 2);
    expect(passing.criticalPercentage).toBe(95);
    expect(passing.violations).toEqual([]);

    const failingLcov = parseLcov(`
SF:src/core/cache.ts
${Array.from({ length: 20 }, (_, index) => `DA:${String(index + 1)},${index >= 18 ? '0' : '1'}`).join('\n')}
end_of_record
`);
    expect(
      evaluateDiffCoverage(
        failingLcov,
        new Map([
          ['src/core/cache.ts', new Set(Array.from({ length: 20 }, (_, index) => index + 1))],
        ]),
      ).violations,
    ).toEqual(['critical changed-line coverage 90.00% is below 95%']);
  });

  it('fails closed when a covered source file disappears from LCOV', () => {
    expect(
      evaluateDiffCoverage(new Map(), new Map([['src/core/runtime.ts', new Set([1])]])).violations,
    ).toEqual(['src/core/runtime.ts is changed but absent from the LCOV report']);
  });

  it('matches the narrow coverage exclusions without hiding neighbouring source', () => {
    expect(matchesPolicyGlob('src/adapters/astro/index.ts', 'src/adapters/**')).toBe(true);
    expect(matchesPolicyGlob('src/core/index.ts', 'src/**/index.ts')).toBe(true);
    expect(matchesPolicyGlob('src/index.ts', 'src/**/index.ts')).toBe(true);
    expect(matchesPolicyGlob('src/core/lifecycle.ts', 'src/**/index.ts')).toBe(false);
  });

  it('rejects threshold lowering and removal of a critical file baseline', () => {
    const previous = clonePolicy();
    const current = clonePolicy() as {
      global: { lines: number };
      criticalFiles: Record<string, { branches: number }>;
    } & CoveragePolicy;
    current.global.lines -= 1;
    current.criticalFiles['src/core/cache.ts']!.branches -= 1;
    delete current.criticalFiles['src/security/csp.ts'];

    expect(findCoveragePolicyRegressions(current, previous)).toEqual([
      'global.lines was lowered',
      'src/core/cache.ts.branches was lowered',
      'critical file baseline was removed: src/security/csp.ts',
    ]);
  });

  it('rejects broadening the reviewed diff-coverage exclusions', () => {
    const previous = clonePolicy();
    const current = clonePolicy() as {
      diff: { ignored: string[] };
    } & CoveragePolicy;
    current.diff.ignored.push('src/**');

    expect(findCoveragePolicyRegressions(current, previous)).toEqual([
      'diff ignored pattern was added: src/**',
    ]);

    const tightened = clonePolicy() as {
      diff: { ignored: string[] };
    } & CoveragePolicy;
    tightened.diff.ignored = tightened.diff.ignored.slice(1);
    expect(findCoveragePolicyRegressions(tightened, previous)).toEqual([]);
  });
});
