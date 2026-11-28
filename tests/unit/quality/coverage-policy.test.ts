import { describe, expect, it } from 'vitest';
import {
  addUntrackedChangedLines,
  COVERAGE_POLICY,
  emitsJavaScript,
  neverInstrumented,
  evaluateDiffCoverage,
  findCoveragePolicyRegressions,
  globCovers,
  resolveComparisonBase,
  matchesPolicyGlob,
  parseChangedLines,
  parseLcov,
  parseMovedFiles,
  type CoveragePolicy,
} from '../../../scripts/coverage-policy';

const clonePolicy = (): CoveragePolicy =>
  JSON.parse(JSON.stringify(COVERAGE_POLICY)) as CoveragePolicy;

describe('coverage policy', () => {
  it('parses only added-line ranges from a zero-context Git diff', () => {
    const diff = [
      'diff --git a/src/runtime/core/cache.ts b/src/runtime/core/cache.ts',
      '--- a/src/runtime/core/cache.ts',
      '+++ b/src/runtime/core/cache.ts',
      '@@ -10,2 +10,3 @@',
      '-old ten',
      '-old eleven',
      '+new ten',
      '+new eleven',
      '+new twelve',
      '@@ -40 +41,0 @@',
      '-deleted',
      'diff --git a/src/runtime/security/csp.ts b/src/runtime/security/csp.ts',
      '--- a/src/runtime/security/csp.ts',
      '+++ b/src/runtime/security/csp.ts',
      '@@ -2 +2 @@',
      '-old csp',
      '+new csp',
    ].join('\n');

    expect([...parseChangedLines(diff)]).toEqual([
      ['src/runtime/core/cache.ts', new Set([10, 11, 12])],
      ['src/runtime/security/csp.ts', new Set([2])],
    ]);
  });

  it('adds every line from untracked source files to changed coverage', () => {
    expect([
      ...addUntrackedChangedLines(
        new Map([['src/runtime/core/cache.ts', new Set([4])]]),
        new Map([
          ['src/runtime/core/cache.ts', 2],
          ['src/runtime/core/new-file.ts', 3],
        ]),
      ),
    ]).toEqual([
      ['src/runtime/core/cache.ts', new Set([4, 1, 2])],
      ['src/runtime/core/new-file.ts', new Set([1, 2, 3])],
    ]);
  });

  it('reads the path whatever prefix the diff gives it', () => {
    // `diff.mnemonicPrefix` writes c/, i/, w/ or o/ for a/ and b/; `diff.noprefix` writes none.
    const hunk = ['@@ -0,0 +1,2 @@', '+const a = 1;', '+const b = 2;'];
    const added = (from: string, to: string): string =>
      [`diff --git ${from} ${to}`, `--- ${from}`, `+++ ${to}`, ...hunk].join('\n');

    for (const [from, to] of [
      ['a/src/runtime/core/a.ts', 'b/src/runtime/core/a.ts'],
      ['c/src/runtime/core/a.ts', 'w/src/runtime/core/a.ts'],
      ['c/src/runtime/core/a.ts', 'i/src/runtime/core/a.ts'],
      ['src/runtime/core/a.ts', 'src/runtime/core/a.ts'],
    ] as const) {
      expect([...parseChangedLines(added(from, to))]).toEqual([
        ['src/runtime/core/a.ts', new Set([1, 2])],
      ]);
    }
  });

  it('attributes renamed additions to the new path and ignores deleted files', () => {
    const diff = [
      'diff --git a/src/runtime/core/old.ts b/src/runtime/core/new.ts',
      'similarity index 80%',
      'rename from src/runtime/core/old.ts',
      'rename to src/runtime/core/new.ts',
      '--- a/src/runtime/core/old.ts',
      '+++ b/src/runtime/core/new.ts',
      '@@ -2 +2,2 @@',
      ' unchanged',
      '+added',
      'diff --git a/src/runtime/core/deleted.ts b/src/runtime/core/deleted.ts',
      'deleted file mode 100644',
      '--- a/src/runtime/core/deleted.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-deleted',
    ].join('\n');

    expect([...parseChangedLines(diff)]).toEqual([['src/runtime/core/new.ts', new Set([3])]]);
  });

  it('enforces aggregate changed-line and stricter critical changed-line budgets', () => {
    const lcov = parseLcov(`
SF:src/runtime/core/cache.ts
${Array.from({ length: 20 }, (_, index) => `DA:${String(index + 1)},${index === 19 ? '0' : '1'}`).join('\n')}
end_of_record
SF:src/runtime/core/runtime.ts
${Array.from({ length: 10 }, (_, index) => `DA:${String(index + 1)},${index === 9 ? '0' : '1'}`).join('\n')}
end_of_record
`);
    const changed = new Map([
      ['src/runtime/core/cache.ts', new Set(Array.from({ length: 20 }, (_, index) => index + 1))],
      ['src/runtime/core/runtime.ts', new Set(Array.from({ length: 10 }, (_, index) => index + 1))],
    ]);

    // Which file is critical is pinned here rather than read from the shipped
    // policy: this asserts the two budgets, not the current critical scope.
    const policy = clonePolicy() as { criticalFiles: Record<string, unknown> } & CoveragePolicy;
    policy.criticalFiles = {
      'src/runtime/core/cache.ts': { lines: 96, functions: 100, branches: 95 },
    };

    const passing = evaluateDiffCoverage(lcov, changed, policy);
    expect(passing.percentage).toBeCloseTo(93.33, 2);
    expect(passing.criticalPercentage).toBe(95);
    expect(passing.violations).toEqual([]);

    const failingLcov = parseLcov(`
SF:src/runtime/core/cache.ts
${Array.from({ length: 20 }, (_, index) => `DA:${String(index + 1)},${index >= 18 ? '0' : '1'}`).join('\n')}
end_of_record
`);
    expect(
      evaluateDiffCoverage(
        failingLcov,
        new Map([
          [
            'src/runtime/core/cache.ts',
            new Set(Array.from({ length: 20 }, (_, index) => index + 1)),
          ],
        ]),
        policy,
      ).violations,
    ).toEqual(['critical changed-line coverage 90.00% is below 95%']);
  });

  it('fails closed when a covered source file disappears from LCOV', () => {
    expect(
      evaluateDiffCoverage(new Map(), new Map([['src/runtime/core/runtime.ts', new Set([1])]]))
        .violations,
    ).toEqual(['src/runtime/core/runtime.ts is changed but absent from the LCOV report']);
  });

  it('tells a declaration-only module from one that emits code', () => {
    expect(
      emitsJavaScript('export interface A { readonly b: string }\nexport type C = A | null;'),
    ).toBe(false);
    // Only a comment survives the transpile, which is not code.
    expect(emitsJavaScript('/** Just documentation. */\nexport type A = string;')).toBe(false);
    expect(emitsJavaScript('export const a = 1;')).toBe(true);
    expect(emitsJavaScript('export enum A { b }')).toBe(true);
  });

  it('names the file types vitest never executes, and nothing else', () => {
    // A changed Astro component has no LCOV entry by construction: Astro
    // compiles it and the browser suite exercises it. Demanding one would fail
    // a documentation edit, which is what surfaced this.
    expect(neverInstrumented('src/adapters/astro/RichText.astro')).toBe(true);
    expect(neverInstrumented('src/adapters/astro/PreviewBoundary.astro')).toBe(true);
    expect(neverInstrumented('src/adapters/astro/index.ts')).toBe(false);
    expect(neverInstrumented('src/runtime/core/astro.ts')).toBe(false);
  });

  it('matches the narrow coverage exclusions without hiding neighbouring source', () => {
    expect(matchesPolicyGlob('src/adapters/astro/index.ts', 'src/adapters/**')).toBe(true);
    expect(matchesPolicyGlob('src/runtime/core/index.ts', 'src/**/index.ts')).toBe(true);
    expect(matchesPolicyGlob('src/index.ts', 'src/**/index.ts')).toBe(true);
    expect(matchesPolicyGlob('src/runtime/core/lifecycle.ts', 'src/**/index.ts')).toBe(false);
  });

  it('rejects threshold lowering and removal of a critical file baseline', () => {
    const previous = clonePolicy();
    const current = clonePolicy() as {
      global: { lines: number };
      criticalFiles: Record<string, { branches: number }>;
    } & CoveragePolicy;
    current.global.lines -= 1;
    current.criticalFiles['src/runtime/core/bindings/cache.ts']!.branches -= 1;
    delete current.criticalFiles['src/runtime/security/csp.ts'];

    expect(findCoveragePolicyRegressions(current, previous)).toEqual([
      'global.lines was lowered',
      'src/runtime/core/bindings/cache.ts.branches was lowered',
      'critical file baseline was removed: src/runtime/security/csp.ts',
    ]);
  });

  it('lets a baseline leave with a deleted file and holds a renamed file to it under its new path', () => {
    const previous = clonePolicy();
    const withoutCsp = clonePolicy() as {
      criticalFiles: Record<string, { lines: number; functions: number; branches: number }>;
    } & CoveragePolicy;
    const csp = withoutCsp.criticalFiles['src/runtime/security/csp.ts']!;
    delete withoutCsp.criticalFiles['src/runtime/security/csp.ts'];

    // Deleted: nothing is left to hold.
    expect(
      findCoveragePolicyRegressions(
        withoutCsp,
        previous,
        new Map([['src/runtime/security/csp.ts', null]]),
      ),
    ).toEqual([]);

    // Renamed without its baseline: the removal is still a removal.
    const renamed = new Map([
      ['src/runtime/security/csp.ts', 'src/runtime/security/policy/csp.ts'],
    ]);
    expect(findCoveragePolicyRegressions(withoutCsp, previous, renamed)).toEqual([
      'critical file baseline was removed: src/runtime/security/csp.ts',
    ]);

    // Renamed with its baseline: held under the new path, and not lower.
    withoutCsp.criticalFiles['src/runtime/security/policy/csp.ts'] = { ...csp };
    expect(findCoveragePolicyRegressions(withoutCsp, previous, renamed)).toEqual([]);
    withoutCsp.criticalFiles['src/runtime/security/policy/csp.ts'] = {
      ...csp,
      branches: csp.branches - 1,
    };
    expect(findCoveragePolicyRegressions(withoutCsp, previous, renamed)).toEqual([
      'src/runtime/security/policy/csp.ts.branches was lowered',
    ]);
  });

  it('reads deletions and renames off a name-status diff and nothing else', () => {
    expect(
      parseMovedFiles(
        ['D\tsrc/a.ts', 'R096\tsrc/b.ts\tsrc/x/b.ts', 'M\tsrc/c.ts', 'A\tsrc/d.ts', ''].join('\n'),
      ),
    ).toEqual(
      new Map<string, string | null>([
        ['src/a.ts', null],
        ['src/b.ts', 'src/x/b.ts'],
      ]),
    );
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

  it('lets an exclusion that names one file follow that file through a rename', () => {
    const previous = clonePolicy() as { diff: { ignored: string[] } } & CoveragePolicy;
    previous.diff.ignored = ['src/**/index.ts', 'src/client/config.ts'];
    const current = clonePolicy() as { diff: { ignored: string[] } } & CoveragePolicy;
    current.diff.ignored = ['src/**/index.ts', 'src/runtime/client/config.ts'];
    const renamed = new Map([['src/client/config.ts', 'src/runtime/client/config.ts']]);

    expect(findCoveragePolicyRegressions(current, previous, renamed)).toEqual([]);
    // Without the rename it is a new exclusion, and so is another file's path.
    expect(findCoveragePolicyRegressions(current, previous)).toEqual([
      'diff ignored pattern was added: src/runtime/client/config.ts',
    ]);
    current.diff.ignored = ['src/**/index.ts', 'src/runtime/client/other.ts'];
    expect(findCoveragePolicyRegressions(current, previous, renamed)).toEqual([
      'diff ignored pattern was added: src/runtime/client/other.ts',
    ]);
    // A glob is no file: a rename of the path it happens to spell moves nothing.
    previous.diff.ignored = ['src/**/index.ts', 'src/client/*.ts'];
    current.diff.ignored = ['src/**/index.ts', 'src/runtime/client/*.ts'];
    expect(
      findCoveragePolicyRegressions(
        current,
        previous,
        new Map([['src/client/*.ts', 'src/runtime/client/*.ts']]),
      ),
    ).toEqual(['diff ignored pattern was added: src/runtime/client/*.ts']);
  });

  it('accepts narrowing an exclusion to files it already covered', () => {
    const previous = clonePolicy() as { diff: { ignored: string[] } } & CoveragePolicy;
    previous.diff.ignored = ['src/**/index.ts', 'src/tools/codegen/**'];
    const narrowed = clonePolicy() as { diff: { ignored: string[] } } & CoveragePolicy;
    narrowed.diff.ignored = [
      'src/**/index.ts',
      'src/tools/codegen/cli.ts',
      'src/tools/codegen/*.plugin.ts',
    ];
    expect(findCoveragePolicyRegressions(narrowed, previous)).toEqual([]);

    const widened = clonePolicy() as { diff: { ignored: string[] } } & CoveragePolicy;
    widened.diff.ignored = ['src/**/index.ts', 'src/tools/codegen/**', 'src/runtime/core/cli.ts'];
    expect(findCoveragePolicyRegressions(widened, previous)).toEqual([
      'diff ignored pattern was added: src/runtime/core/cli.ts',
    ]);
  });

  it('decides glob coverage on a representative path', () => {
    expect(globCovers('src/tools/codegen/**', 'src/tools/codegen/cli.ts')).toBe(true);
    expect(globCovers('src/tools/codegen/**', 'src/tools/codegen/nested/*.ts')).toBe(true);
    expect(globCovers('src/tools/codegen/*', 'src/tools/codegen/**')).toBe(false);
    expect(globCovers('src/adapters/**', 'src/tools/codegen/cli.ts')).toBe(false);
  });

  it('keeps the adapters and the codegen library under the diff gate', () => {
    const ignored = COVERAGE_POLICY.diff.ignored;
    const uncovered = (path: string) => ignored.some((glob) => matchesPolicyGlob(path, glob));
    expect(uncovered('src/adapters/nuxt/adapter.ts')).toBe(false);
    expect(uncovered('src/tools/codegen/generate.ts')).toBe(false);
    // Only the CLI runs as a subprocess; the Astro plugin has direct tests.
    expect(uncovered('src/tools/codegen/cli.ts')).toBe(true);
    expect(uncovered('src/tools/codegen/astro-plugin.ts')).toBe(false);
  });
});

/**
 * The commit a run measures its changed lines against. A force-push or a
 * rebase leaves the commit CI names outside the repository, and a coverage
 * gate must not fail a branch over its history.
 */
describe('resolveComparisonBase', () => {
  const MERGE_BASE = 'a'.repeat(40);
  const PARENT = 'b'.repeat(40);
  const GONE = 'c'.repeat(40);

  /** A git that answers the two questions this function asks, or refuses to. */
  function git(answers: { readonly mergeBase?: string; readonly parent?: string }) {
    return (arguments_: readonly string[]): string => {
      const wanted = arguments_[0] === 'merge-base' ? answers.mergeBase : answers.parent;
      if (wanted === undefined) throw new Error('unknown revision');
      return `${wanted}\n`;
    };
  }

  function recorder() {
    const warnings: string[] = [];
    return {
      warnings,
      options: {
        ci: true,
        warn: (message: string) => {
          warnings.push(message);
        },
      },
    };
  }

  it('uses the merge base when the requested base is in the repository', () => {
    const { warnings, options } = recorder();
    const git_ = git({ mergeBase: MERGE_BASE, parent: PARENT });
    expect(resolveComparisonBase('origin/main', git_, options)).toBe(MERGE_BASE);
    expect(warnings).toEqual([]);
  });

  it('falls back to the parent commit when the base is gone, and names both', () => {
    const { warnings, options } = recorder();
    expect(resolveComparisonBase(GONE, git({ parent: PARENT }), options)).toBe(PARENT);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(GONE);
    expect(warnings[0]).toContain(PARENT);
  });

  it.each([
    ['an empty merge base counts as unresolvable', { mergeBase: '', parent: PARENT }, PARENT],
    ['a resolvable base wins over the fallback', { mergeBase: MERGE_BASE }, MERGE_BASE],
  ] as const)('%s', (_case, answers, expected) => {
    const { options } = recorder();
    expect(resolveComparisonBase(GONE, git(answers), options)).toBe(expected);
  });

  it.each([
    ['no parent at all', {}],
    ['an empty parent', { parent: '' }],
  ] as const)('fails on %s, naming the base it could not resolve', (_case, answers) => {
    const { options } = recorder();
    expect(() => resolveComparisonBase(GONE, git(answers), options)).toThrow(
      new RegExp(`cannot resolve coverage diff base ${GONE}`),
    );
  });

  it('requires a base in CI and defaults to HEAD outside it', () => {
    const { options } = recorder();
    expect(() => resolveComparisonBase(undefined, git({}), options)).toThrow(/required in CI/);
    expect(resolveComparisonBase(undefined, git({}), { ...options, ci: false })).toBe('HEAD');
  });
});
