/**
 * Feature support counts as evidence only when every product dimension is explicit.
 * Executed success additionally needs a retained result whose identity can be checked.
 */

import { describe, expect, it } from 'vitest';
import {
  featureEvidenceProblems,
  peerFloor,
  REQUIRED_COMPAT_SURFACES,
  scriptSemverPins,
  type CompatEvidenceCell,
  type CompatEvidenceFacts,
} from '../../../scripts/compat-evidence';

const cell = (overrides: Partial<CompatEvidenceCell> = {}): CompatEvidenceCell => ({
  id: 'astro-base-current',
  surface: 'Astro',
  feature: 'base live preview',
  version: {
    kind: 'exact',
    value: '7.3.2',
    package: 'astro',
    source: {
      kind: 'lockfile',
      fixture: 'examples/astro-payload',
    },
  },
  mode: 'production',
  packageForm: 'copied-local-package',
  backend: 'mock-admin',
  browsers: ['chromium', 'firefox', 'webkit'],
  evidence: {
    status: 'configured',
    workflow: { file: 'ci.yml', job: 'e2e' },
    sources: ['tests/e2e/specs/live-preview.spec.ts'],
  },
  ...overrides,
});

const facts = (overrides: Partial<CompatEvidenceFacts> = {}): CompatEvidenceFacts => ({
  repositoryVersion: '2.0.5',
  peerFloors: { astro: '4.0.0', react: '18.0.0' },
  lockfileVersions: { 'examples/astro-payload\u0000astro': '7.3.2' },
  scriptPins: {
    'scripts/check-package.ts\u0000PAYLOAD_PLUGIN_TYPE_VERSIONS': ['2.32.3', '3.89.0'],
  },
  workflowJobs: {
    'ci.yml\u0000e2e': { conditional: false, continueOnError: false },
  },
  availablePaths: new Set(['tests/e2e/specs/live-preview.spec.ts']),
  resultDigests: {},
  publicEntries: ['.', './astro'],
  toolingEntries: ['./astro'],
  publicBins: ['pll'],
  ...overrides,
});

function inventory(): CompatEvidenceCell[] {
  return REQUIRED_COMPAT_SURFACES.map((surface, index) =>
    cell({
      id: `surface-${String(index)}`,
      surface,
      ...(surface === 'Public entries' ? { entries: ['.', './astro'] } : {}),
      ...(surface === 'Tooling' ? { entries: ['./astro'], bins: ['pll'] } : {}),
    }),
  );
}

describe('feature-specific compatibility evidence', () => {
  it('reads the floor from both open and bounded peer ranges', () => {
    expect(peerFloor('>=18')).toBe('18.0.0');
    expect(peerFloor('>=4.0.0 <8.0.0')).toBe('4.0.0');
    expect(peerFloor('^4.0.0')).toBeUndefined();
    expect(peerFloor('>=4.0.0 || ^3.0.0')).toBeUndefined();
  });

  it('accepts a complete inventory whose configured jobs and source paths exist', () => {
    expect(featureEvidenceProblems(inventory(), facts())).toEqual([]);
  });

  it('requires every advertised product surface, including entries and tooling', () => {
    const problems = featureEvidenceProblems([cell()], facts());

    expect(problems).toContain('compat evidence has no Next.js cell');
    expect(problems).toContain('compat evidence has no Plain HTML cell');
    expect(problems).toContain('compat evidence has no React hook cell');
    expect(problems).toContain('compat evidence has no Vue composable cell');
    expect(problems).toContain('compat evidence has no Payload plugin cell');
    expect(problems).toContain('compat evidence has no Public entries cell');
    expect(problems).toContain('compat evidence has no Tooling cell');
  });

  it('requires the feature, version or floor, mode, package form, backend and browser dimensions', () => {
    const malformed = {
      ...cell(),
      feature: '',
      version: { kind: 'range', value: '^7', package: 'astro' },
      mode: '',
      packageForm: '',
      backend: '',
      browsers: [],
    } as unknown as CompatEvidenceCell;
    const problems = featureEvidenceProblems(
      inventory().map((candidate) => (candidate.surface === 'Astro' ? malformed : candidate)),
      facts(),
    ).join('\n');

    expect(problems).toContain('feature is missing');
    expect(problems).toContain('version kind must be exact or floor');
    expect(problems).toContain('mode is invalid');
    expect(problems).toContain('package form is invalid');
    expect(problems).toContain('backend is missing');
    expect(problems).toContain('browser list is empty');
  });

  it('does not turn a configured job into an executed pass', () => {
    const claimedPass = cell({
      evidence: {
        status: 'passed',
        workflow: { file: 'ci.yml', job: 'e2e' },
        sources: ['tests/e2e/specs/live-preview.spec.ts'],
      },
    });
    const problems = featureEvidenceProblems(
      inventory().map((candidate) => (candidate.surface === 'Astro' ? claimedPass : candidate)),
      facts(),
    );

    expect(problems).toContain(
      'astro-base-current: passed evidence needs an immutable successful result',
    );
  });

  it('does not turn a floating install into exact-floor proof', () => {
    const floatingPass = cell({
      version: { ...cell().version, kind: 'floor', value: '4.0.0', configuredRange: '^4' },
      evidence: {
        status: 'passed',
        workflow: { file: 'ci.yml', job: 'e2e' },
        sources: ['tests/e2e/specs/live-preview.spec.ts'],
      },
    });
    const problems = featureEvidenceProblems(
      inventory().map((candidate) => (candidate.surface === 'Astro' ? floatingPass : candidate)),
      facts({ lockfileVersions: { 'examples/astro-payload\u0000astro': '4.0.0' } }),
    );

    expect(problems).toContain(
      'astro-base-current: a floating configured range cannot be passed evidence',
    );
  });

  it('accepts a pass only with a matching immutable successful result', () => {
    const result = {
      path: 'test-results/compat/astro-base.json',
      sha256: 'a'.repeat(64),
      commit: 'b'.repeat(40),
      executedAt: '2026-09-23T10:00:00.000Z',
      conclusion: 'success' as const,
    };
    const passed = cell({
      evidence: {
        status: 'passed',
        workflow: { file: 'ci.yml', job: 'e2e' },
        sources: ['tests/e2e/specs/live-preview.spec.ts'],
        result,
      },
    });
    const passFacts = facts({
      availablePaths: new Set([
        'tests/e2e/specs/live-preview.spec.ts',
        'test-results/compat/astro-base.json',
      ]),
      resultDigests: { 'test-results/compat/astro-base.json': result.sha256 },
    });

    expect(
      featureEvidenceProblems(
        inventory().map((candidate) => (candidate.surface === 'Astro' ? passed : candidate)),
        passFacts,
      ),
    ).toEqual([]);
  });

  it('refuses missing, conditional or soft-failed configured jobs', () => {
    const conditional = facts({
      workflowJobs: {
        'ci.yml\u0000e2e': { conditional: true, continueOnError: true },
      },
    });
    const problems = featureEvidenceProblems(inventory(), conditional).join('\n');

    expect(problems).toContain('references a conditional workflow job');
    expect(problems).toContain('references a workflow job that may fail softly');
  });

  it('holds exact lockfile versions and peer floors against repository facts', () => {
    const astroFloor = cell({
      version: {
        kind: 'floor',
        value: '4.9.0',
        package: 'astro',
        source: { kind: 'peer-floor' },
      },
    });
    const problems = featureEvidenceProblems(
      inventory().map((candidate) => (candidate.surface === 'Astro' ? astroFloor : candidate)),
      facts(),
    ).join('\n');

    expect(problems).toContain('records peer floor 4.9.0, package.json declares 4.0.0');
  });

  it('holds exact script-pinned versions against the named semver tuple', () => {
    const payloadPlugin = cell({
      id: 'payload-plugin-types-v2',
      surface: 'Payload plugin',
      version: {
        kind: 'exact',
        value: '2.32.3',
        package: 'payload',
        source: {
          kind: 'script-pin',
          file: 'scripts/check-package.ts',
          identifier: 'PAYLOAD_PLUGIN_TYPE_VERSIONS',
        },
      },
    });
    const cells = inventory().map((candidate) =>
      candidate.surface === 'Payload plugin' ? payloadPlugin : candidate,
    );

    expect(featureEvidenceProblems(cells, facts())).toEqual([]);
    expect(
      featureEvidenceProblems(
        cells,
        facts({
          scriptPins: {
            'scripts/check-package.ts\u0000PAYLOAD_PLUGIN_TYPE_VERSIONS': ['3.89.0'],
          },
        }),
      ),
    ).toContain(
      'payload-plugin-types-v2: scripts/check-package.ts constant PAYLOAD_PLUGIN_TYPE_VERSIONS does not pin 2.32.3',
    );
  });

  it('reads a script pin only from the named exact-semver const tuple', () => {
    const source = "const PAYLOAD_PLUGIN_TYPE_VERSIONS = ['2.32.3', '3.89.0'] as const;";

    expect(scriptSemverPins(source, 'PAYLOAD_PLUGIN_TYPE_VERSIONS')).toEqual(['2.32.3', '3.89.0']);
    expect(scriptSemverPins(source, 'OTHER_VERSIONS')).toBeUndefined();
    expect(
      scriptSemverPins(
        "const PAYLOAD_PLUGIN_TYPE_VERSIONS = ['^2.32.3'] as const;",
        'PAYLOAD_PLUGIN_TYPE_VERSIONS',
      ),
    ).toBeUndefined();
  });

  it('inventories every public export and executable exactly once', () => {
    const incomplete = inventory().map((candidate) => {
      if (candidate.surface === 'Public entries') return { ...candidate, entries: ['.'] };
      if (candidate.surface === 'Tooling') return { ...candidate, bins: [] };
      return candidate;
    });
    const problems = featureEvidenceProblems(incomplete, facts()).join('\n');

    expect(problems).toContain('public entry inventory differs');
    expect(problems).toContain('tooling executable inventory differs');
  });
});
