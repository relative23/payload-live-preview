/**
 * The Payload 2 lane plans its browser cases from lanes.json alone: the preparation, the harness
 * run, the result check and the discovery listing read one plan per probe. These cases hold that
 * plan to the specs that write their own titles or use its keys and to the count the README
 * prints, so a claim about the lane cannot outgrow what the lane executes. The plan module runs in
 * its own Node process, as the lane does; it is plain ESM next to the lane, not part of the package.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');
const LANE = resolve(ROOT, 'examples/payload-version-lanes');
const BROWSERS = ['chromium', 'firefox', 'webkit'];
const PROBES = ['dom', 'lifecycle', 'population', 'guards'] as const;

interface Plan {
  readonly engines: readonly string[];
  readonly probes: Readonly<
    Record<
      (typeof PROBES)[number],
      {
        readonly specs: Readonly<
          Record<string, readonly string[] | Readonly<Record<string, string>>>
        >;
        readonly titles: readonly string[];
        readonly cases: number;
      }
    >
  >;
  readonly fits: Readonly<Record<string, readonly string[]>>;
}

interface LaneDefinition {
  readonly lanes: {
    readonly v2: Readonly<Record<string, unknown>> & {
      readonly nativeLifecycleTitles: Readonly<Record<string, string>>;
      readonly nativeGuardsTitles: Readonly<Record<string, string>>;
      readonly nativePopulationTitles: Readonly<Record<string, string>>;
    };
  };
}

const PROGRAM = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { engines, v2Cases, v2ProbeFits, v2Specs, v2Titles } = await import(
  pathToFileURL(process.env.PLP_PLAN).href
);
const lane = JSON.parse(readFileSync(process.env.PLP_LANES, 'utf8')).lanes.v2;
const probes = {};
const fits = {};
for (const probe of ['dom', 'lifecycle', 'population', 'guards']) {
  probes[probe] = {
    specs: v2Specs(lane, probe),
    titles: v2Titles(lane, probe),
    cases: v2Cases(lane, probe),
  };
  fits[probe] = ['dom', 'react', 'vue'].filter((surface) => v2ProbeFits(probe, surface));
}
console.log(JSON.stringify({ engines, probes, fits }));
`;

// The harness checks the plan it is handed twice, when the run file is written and when it is read.
const CHECK = `
import { pathToFileURL } from 'node:url';
const { specTitlesProblem } = await import(pathToFileURL(process.env.PLP_IDENTITY).href);
const plans = JSON.parse(process.env.PLP_PLANS);
console.log(JSON.stringify(plans.map((plan) => specTitlesProblem(plan) ?? null)));
`;

function problems(plans: readonly unknown[]): (string | null)[] {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', CHECK], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PLP_IDENTITY: resolve(LANE, 'v2/identity.mjs'),
      PLP_PLANS: JSON.stringify(plans),
    },
  });
  return JSON.parse(stdout) as (string | null)[];
}

function plan(): Plan {
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', PROGRAM], {
    encoding: 'utf8',
    timeout: 20_000,
    env: {
      ...process.env,
      PLP_PLAN: resolve(LANE, 'plan.mjs'),
      PLP_LANES: resolve(LANE, 'lanes.json'),
    },
  });
  return JSON.parse(stdout) as Plan;
}

const lane = (JSON.parse(readFileSync(resolve(LANE, 'lanes.json'), 'utf8')) as LaneDefinition).lanes
  .v2;

/** The titles a spec writes as `test('…', …)` literals, in file order. */
function writtenTitles(file: string): string[] {
  const source = readFileSync(resolve(LANE, 'v2/browser', file), 'utf8');
  return [...source.matchAll(/^test\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/gmu)].map(
    (match) => match[2] ?? '',
  );
}

describe('Payload 2 lane case plan', () => {
  it('plans every title once in every browser and stores no count of its own', () => {
    const { engines, probes } = plan();
    expect(engines).toEqual(BROWSERS);
    for (const { titles, cases } of Object.values(probes)) {
      expect(titles.length).toBeGreaterThan(0);
      expect(new Set(titles).size).toBe(titles.length);
      expect(cases).toBe(titles.length * BROWSERS.length);
    }
    for (const stale of ['expectedCases', 'nativeLifecycleCasesPerSurfaceVariant']) {
      expect(lane).not.toHaveProperty(stale);
    }
  });

  it('runs one spec file per probe and fits each probe to its surfaces', () => {
    const { probes, fits } = plan();
    expect(Object.keys(probes.dom.specs)).toEqual(['payload2.spec.cjs']);
    expect(Object.keys(probes.lifecycle.specs)).toEqual(['native-lifecycle.spec.cjs']);
    expect(Object.keys(probes.population.specs)).toEqual(['native-population.spec.cjs']);
    expect(Object.keys(probes.guards.specs)).toEqual(['native-guards.spec.cjs']);
    expect(fits).toEqual({
      dom: ['dom'],
      lifecycle: ['react', 'vue'],
      population: ['react', 'vue'],
      guards: ['react', 'vue'],
    });
  });

  it('keeps the titles written in the DOM spec in step with lanes.json', () => {
    const { probes } = plan();
    expect(writtenTitles('payload2.spec.cjs')).toEqual(probes.dom.specs['payload2.spec.cjs']);
  });

  it.each([
    ['native-lifecycle.spec.cjs', 'nativeLifecycleTitles'],
    ['native-population.spec.cjs', 'nativePopulationTitles'],
    ['native-guards.spec.cjs', 'nativeGuardsTitles'],
  ] as const)(
    'writes no title of its own in %s and uses every key lanes.json names',
    (file, key) => {
      const source = readFileSync(resolve(LANE, 'v2/browser', file), 'utf8');
      expect(writtenTitles(file)).toEqual([]);
      const used = [...source.matchAll(/\btitles\.(\w+)/gu)].map((match) => match[1]);
      expect([...new Set(used)].sort()).toEqual(Object.keys(lane[key]).sort());
    },
  );

  it('prints the planned count of every probe in the lane README', () => {
    const { probes } = plan();
    const readme = readFileSync(resolve(LANE, 'README.md'), 'utf8');
    const row = readme.split('\n').find((line) => line.startsWith('| `v2` |'));
    expect(row).toContain(`${probes.dom.cases} DOM/session cases`);
    expect(row).toContain(`${probes.lifecycle.cases} lifecycle`);
    expect(row).toContain(`${probes.population.cases} population cases`);
    expect(row).toContain(`${probes.guards.cases} guard`);
  });

  it('prints in the README the count every variant of the population checks plans', () => {
    const { probes } = plan();
    // DOM, React and Vue, each in two modes: one count for all six variants.
    expect(probes.population.cases).toBe(probes.dom.cases);
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const row = readme.split('\n').find((line) => line.startsWith('| Payload 2.32.3 |'));
    expect(row).toContain(`${probes.dom.cases} per variant, six variants`);
    const matrix = readFileSync(resolve(ROOT, 'quality/compat-matrix.json'), 'utf8');
    expect(matrix).toContain(`(${probes.dom.cases} browser cases per variant)`);
  });

  it('prints in the README and the ledger the count every variant of the lifecycle checks plans', () => {
    const { probes } = plan();
    // React and Vue, each in two modes: the DOM runtime has no lifecycle probe.
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const row = readme
      .split('\n')
      .find((line) => line.startsWith('| Payload 2.32.3 |') && line.includes('lifecycle'));
    expect(row).toContain(`${probes.lifecycle.cases} per variant, four variants`);
    const matrix = readFileSync(resolve(ROOT, 'quality/compat-matrix.json'), 'utf8');
    expect(matrix).toContain(`(${probes.lifecycle.cases} browser cases per variant)`);
  });

  it('prints in the README and the ledger the count every variant of the guards checks plans', () => {
    const { probes } = plan();
    // React and Vue, each in two modes, like the lifecycle checks.
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const row = readme
      .split('\n')
      .find((line) => line.startsWith('| Payload 2.32.3 |') && line.includes('guards'));
    expect(row).toContain(`${probes.guards.cases} per variant, four variants`);
    const matrix = readFileSync(resolve(ROOT, 'quality/compat-matrix.json'), 'utf8');
    expect(matrix).toContain(`(${probes.guards.cases} browser cases per variant)`);
  });

  it('refuses a case plan that names no spec, no title or a title twice', () => {
    expect(
      problems([
        { 'a.spec.cjs': ['one'] },
        { 'a.spec.cjs': ['one'], 'b.spec.cjs': { two: 'two' } },
        null,
        [],
        {},
        { 'a.js': ['one'] },
        { 'a.spec.cjs': [] },
        { 'a.spec.cjs': ['one', 'one'] },
        { 'a.spec.cjs': ['one'], 'b.spec.cjs': { again: 'one' } },
        { 'a.spec.cjs': [''] },
        { 'a.spec.cjs': [1] },
      ]),
    ).toEqual([
      null,
      null,
      'expected an object of spec files',
      'expected an object of spec files',
      'no spec file',
      'unexpected spec file name',
      'no titles for a.spec.cjs',
      'a title is written twice',
      'a title is written twice',
      'a title is not a non-empty string',
      'a title is not a non-empty string',
    ]);
  });
});
