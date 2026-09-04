import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateMutationReport, type MutationPolicy } from '../../../scripts/mutation-policy';
import { summarizeMutationReport } from '../../../scripts/mutation-report';

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

const prPolicy = (overrides: Partial<MutationPolicy['baseline']> = {}): MutationPolicy => ({
  ...policy(overrides),
  profile: 'pr-critical',
  report: {
    ...policy(overrides).report,
    thresholds: { high: 95, low: 90, break: 90 },
  },
});

const report = (
  statuses: Readonly<Record<(typeof SCOPE)[number], readonly Status[]>> = {
    'src/core/cache.ts': ['Killed', 'Killed', 'Survived', 'NoCoverage'],
    'src/security/csp.ts': ['Killed', 'Killed', 'Timeout', 'RuntimeError'],
  },
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

const prReport = (statuses: readonly Status[]): unknown => ({
  schemaVersion: '1.0',
  framework: { name: 'StrykerJS', version: '9.6.1' },
  config: {
    configFile: 'stryker.config.js',
    mutate: [...SCOPE],
    testRunner: 'vitest',
    vitest: { configFile: 'vitest.stryker.config.ts', related: true },
    coverageAnalysis: 'perTest',
    incremental: false,
    thresholds: { high: 95, low: 90, break: 90 },
    mutator: { excludedMutations: [] },
    ignorers: [],
  },
  files: {
    [SCOPE[0]]: {
      language: 'typescript',
      source: '',
      mutants: statuses
        .slice(0, 4)
        .map((status, index) => ({ id: `cache-${String(index)}`, status })),
    },
    [SCOPE[1]]: {
      language: 'typescript',
      source: '',
      mutants: statuses.slice(4).map((status, index) => ({ id: `csp-${String(index)}`, status })),
    },
  },
});

describe('nightly mutation policy', () => {
  it('keeps the checked-in PR policy on the reviewed scope and zero terminal-error budget', () => {
    const checkedIn = JSON.parse(
      readFileSync(resolve(process.cwd(), 'quality/mutation-policy-pr.json'), 'utf8'),
    ) as MutationPolicy;

    expect(checkedIn).toMatchObject({
      schemaVersion: 1,
      profile: 'pr-critical',
      report: {
        schemaVersion: '1.0',
        framework: { name: 'StrykerJS', version: '9.6.1' },
        strykerConfigFile: 'stryker.config.js',
        vitestConfigFile: 'vitest.stryker.config.ts',
        testRunner: 'vitest',
        coverageAnalysis: 'perTest',
        incremental: false,
        thresholds: { high: 95, low: 90, break: 90 },
      },
      scope: ['src/core/field-value.ts', 'src/security/csp.ts', 'src/security/url-validator.ts'],
      baseline: {
        total: 347,
        mutationScoreMinimum: 93.66,
        mutationScorePrecision: 2,
        // One timeout on a loaded runner moves the score by one mutant.
        mutationScoreDriftMutants: 2,
        noCoverageMaximum: 0,
        timeoutMaximum: 2,
        errorMaximum: 0,
        ignoredMaximum: 0,
      },
    });
  });

  it('summarises every terminal mutant class and the Stryker mutation score', () => {
    expect(summarizeMutationReport(report())).toEqual({
      total: 8,
      killed: 4,
      survived: 1,
      noCoverage: 1,
      timeout: 1,
      errors: 1,
      ignored: 0,
      mutationScore: 71.42857142857143,
    });
  });

  it('accepts the exact reviewed profile at its ratcheted baseline', () => {
    const result = evaluateMutationReport(report(), policy());
    expect(result.summary.total).toBe(8);
    expect(result.summary.mutationScore).toBe(71.42857142857143);
    expect(result.violations).toEqual([]);
  });

  it('rejects a superseded partial scope even when its numeric quality passes', () => {
    const partial = report({
      'src/core/cache.ts': ['Killed', 'Killed', 'Killed', 'Killed'],
      'src/security/csp.ts': [],
    });
    const object = partial as {
      config: { mutate: string[] };
      files: Record<string, unknown>;
    };
    object.config.mutate = ['src/core/cache.ts'];
    delete object.files['src/security/csp.ts'];

    expect(evaluateMutationReport(partial, policy()).violations).toEqual([
      expect.stringContaining('[profile] configured mutation scope differs'),
      expect.stringContaining('[profile] reported file scope differs'),
    ]);
  });

  it('rejects profile drift and any blanket mutation exclusion', () => {
    const drifted = report() as {
      framework: { version: string };
      config: {
        vitest: { configFile: string };
        coverageAnalysis: string;
        incremental: boolean;
        thresholds: { high: number; low: number; break: number | null };
        mutator: { excludedMutations: string[] };
        ignorers: string[];
      };
    };
    drifted.framework.version = '10.0.0';
    drifted.config.vitest.configFile = 'vitest.config.ts';
    drifted.config.coverageAnalysis = 'off';
    drifted.config.incremental = true;
    drifted.config.thresholds.break = null;
    drifted.config.mutator.excludedMutations = ['ConditionalExpression'];
    drifted.config.ignorers = ['custom-ignorer'];

    expect(evaluateMutationReport(drifted, policy()).violations).toEqual([
      expect.stringContaining('[profile] framework differs'),
      expect.stringContaining('[profile] Vitest config differs'),
      expect.stringContaining('[profile] coverage analysis differs'),
      expect.stringContaining('[profile] incremental report is not a baseline'),
      expect.stringContaining('[profile] thresholds differ'),
      expect.stringContaining('[profile] excluded mutations are not allowed'),
      expect.stringContaining('[profile] mutation ignorers are not allowed'),
    ]);
  });

  it('supports an exact PR profile while rejecting malformed policy metadata', () => {
    expect(
      evaluateMutationReport(
        prReport(Array(8).fill('Killed') as Status[]),
        prPolicy({
          total: 8,
          mutationScoreMinimum: 100,
          noCoverageMaximum: 0,
          timeoutMaximum: 0,
          errorMaximum: 0,
        }),
      ).violations,
    ).toEqual([]);

    const malformed = prPolicy({ total: 8, mutationScoreMinimum: 100 }) as unknown as {
      schemaVersion: number;
      profile: string;
    } & MutationPolicy;
    malformed.schemaVersion = 2;
    malformed.profile = 'ad-hoc';

    expect(
      evaluateMutationReport(prReport(Array(8).fill('Killed') as Status[]), malformed).violations,
    ).toEqual([
      '[policy] unsupported policy schemaVersion 2; expected 1',
      '[policy] unsupported mutation profile ad-hoc',
    ]);
  });

  it.each(['NoCoverage', 'Timeout', 'RuntimeError', 'CompileError', 'Ignored'] as const)(
    'rejects a PR %s mutant even when the remaining mutants are killed',
    (status) => {
      const statuses: Status[] = Array(8).fill('Killed') as Status[];
      statuses[7] = status;
      const result = evaluateMutationReport(
        prReport(statuses),
        prPolicy({
          total: 8,
          mutationScoreMinimum: status === 'NoCoverage' ? 87.5 : 100,
          noCoverageMaximum: 0,
          timeoutMaximum: 0,
          errorMaximum: 0,
          ignoredMaximum: 0,
        }),
      );

      expect(result.violations).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            status === 'NoCoverage'
              ? /no-coverage mutants 1 exceed reviewed maximum 0/u
              : status === 'Timeout'
                ? /timeout mutants 1 exceed reviewed maximum 0/u
                : status === 'Ignored'
                  ? /ignored mutants 1 exceed reviewed maximum 0/u
                  : /error mutants 1 exceed reviewed maximum 0/u,
          ),
        ]),
      );
    },
  );

  it('fails closed on incomplete or unknown mutant statuses', () => {
    const incomplete = report() as {
      files: Record<string, { mutants: { status: string }[] }>;
    };
    incomplete.files['src/core/cache.ts']!.mutants[0]!.status = 'Pending';

    expect(() => summarizeMutationReport(incomplete)).toThrow(/unsupported mutant status Pending/u);
  });

  it('rejects regressions in total, score and every failure-class maximum', () => {
    const regressionPolicy = policy({
      total: 7,
      mutationScoreMinimum: 71.4287,
      noCoverageMaximum: 0,
      timeoutMaximum: 0,
      errorMaximum: 0,
    });

    expect(evaluateMutationReport(report(), regressionPolicy).violations).toEqual([
      '[regression] total mutants increased from 7 to 8; review the expanded mutation surface',
      '[regression] mutation score 71.4286 is below reviewed minimum 71.4287',
      '[regression] no-coverage mutants 1 exceed reviewed maximum 0',
      '[regression] timeout mutants 1 exceed reviewed maximum 0',
      '[regression] error mutants 1 exceed reviewed maximum 0',
    ]);
  });

  it('reports quality improvements as a stale policy that must be ratcheted', () => {
    const improved = report({
      'src/core/cache.ts': ['Killed', 'Killed', 'Killed', 'Survived'],
      'src/security/csp.ts': ['Killed', 'Killed', 'Killed', 'Killed'],
    });

    const result = evaluateMutationReport(improved, policy());

    expect(result.violations).toEqual([
      '[improvement] mutation score 87.5 exceeds reviewed minimum 71.4286; ratchet the policy',
      '[improvement] no-coverage mutants improved from 1 to 0; ratchet the policy',
      '[improvement] error mutants improved from 1 to 0; ratchet the policy',
    ]);
    // Timeouts are the exception: see below.
    expect(result.notices).toContain(
      '[drift] timeout mutants 0 is below the reviewed ceiling 1; ' +
        'expected for a machine-dependent count, worth lowering if it persists',
    );
  });

  it('treats the timeout count as a ceiling, because it measures the machine', () => {
    // A loaded runner times a mutant out where a quiet one kills it, and the
    // nightly figure is the sum over three shards on three runners. A run that
    // times out *less* must not be the thing that stops a release; one that
    // times out more still is, and the score is unaffected either way because
    // Stryker counts a timeout as detected.
    const quiet = report({
      'src/core/cache.ts': ['Killed', 'Survived', 'NoCoverage', 'RuntimeError'],
      'src/security/csp.ts': ['Killed', 'Killed', 'Killed', 'Killed'],
    });
    expect(
      evaluateMutationReport(quiet, policy({ timeoutMaximum: 3 })).violations.filter((v) =>
        v.includes('timeout'),
      ),
    ).toEqual([]);

    expect(evaluateMutationReport(report(), policy({ timeoutMaximum: 0 })).violations).toContain(
      '[regression] timeout mutants 1 exceed reviewed maximum 0',
    );
  });

  it('reports score drift inside the noise band without failing the run', () => {
    // One mutant that survives on one machine and dies on another moves the
    // score, and comparing it exactly turns scheduling luck into a red release.
    // The drift must stay visible — that is how untested guards get found — but
    // it must not be the thing that stops a release.
    const result = evaluateMutationReport(
      report(),
      policy({ mutationScoreMinimum: 71.5, mutationScoreDriftMutants: 1 }),
    );

    expect(result.violations).toEqual([]);
    expect(result.notices).toEqual([
      '[drift] mutation score 71.4286 differs from reviewed 71.5 within the 1-mutant noise band; ' +
        'not failed, but a repeated drift is worth diagnosing',
    ]);
  });

  it('still fails a drop and still demands a ratchet beyond the band', () => {
    expect(
      evaluateMutationReport(
        report(),
        policy({ mutationScoreMinimum: 90, mutationScoreDriftMutants: 1 }),
      ).violations,
    ).toEqual(['[regression] mutation score 71.4286 is below reviewed minimum 90']);

    expect(
      evaluateMutationReport(
        report(),
        policy({ mutationScoreMinimum: 50, mutationScoreDriftMutants: 1 }),
      ).violations,
    ).toEqual([
      '[improvement] mutation score 71.4286 exceeds reviewed minimum 50; ratchet the policy',
    ]);
  });

  it('compares exactly when no band is declared', () => {
    // Omitting the field must not quietly widen an existing policy.
    const result = evaluateMutationReport(report(), policy({ mutationScoreMinimum: 71.5 }));

    expect(result.violations).toEqual([
      '[regression] mutation score 71.4286 is below reviewed minimum 71.5',
    ]);
    expect(result.notices).toEqual([]);
  });

  it('reports a lower total as an explicit production-code reduction to ratchet', () => {
    const reduced = report({
      'src/core/cache.ts': ['Killed', 'Killed'],
      'src/security/csp.ts': ['Killed', 'Killed', 'Killed'],
    });

    expect(
      evaluateMutationReport(
        reduced,
        policy({
          total: 8,
          mutationScoreMinimum: 100,
          noCoverageMaximum: 0,
          timeoutMaximum: 0,
          errorMaximum: 0,
        }),
      ).violations,
    ).toEqual(['[improvement] total mutants decreased from 8 to 5; ratchet the policy']);
  });
});

describe('stale mutation reports', () => {
  const sources = (): Map<string, string> =>
    new Map([
      ['src/core/cache.ts', ''],
      ['src/security/csp.ts', ''],
    ]);

  it('accepts a report whose mutated sources match the working tree', () => {
    expect(evaluateMutationReport(report(), policy(), sources()).violations).toEqual([]);
  });

  it('refuses a report mutated from a different source than the working tree', () => {
    const tree = sources();
    tree.set('src/core/cache.ts', 'export const changedSinceTheRun = true;\n');
    expect(evaluateMutationReport(report(), policy(), tree).violations).toEqual([
      '[stale] src/core/cache.ts differs from the source the report mutated; rerun the mutation suite',
    ]);
  });

  it('refuses a report for a file the working tree no longer has', () => {
    const tree = sources();
    tree.delete('src/security/csp.ts');
    expect(evaluateMutationReport(report(), policy(), tree).violations).toEqual([
      '[stale] src/security/csp.ts is not readable in this working tree',
    ]);
  });

  it('compares sources independently of line endings', () => {
    const fabricated = report() as { files: Record<string, { source: string }> };
    fabricated.files['src/core/cache.ts']!.source = 'a\r\nb\n';
    const tree = sources();
    tree.set('src/core/cache.ts', 'a\nb\n');
    expect(evaluateMutationReport(fabricated, policy(), tree).violations).toEqual([]);
  });
});
