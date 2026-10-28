import { describe, expect, it } from 'vitest';
import {
  HARNESS_INSTALLS,
  engineProblems,
  readInstalls,
  type FixtureInstall,
  type Lockfile,
} from '../../../scripts/compat-engines';
import { lowestRelease, satisfies } from '../../../scripts/compat-engines-range';
import { astroResourceVersion } from '../../e2e/helpers/astro-resource-versions';

/**
 * On 2026-10-27 the release soak ran Node 22.23.2 and served the Astro fixture, whose lockfile
 * pins astro 7.4.2 with `engines.node >=22.23.4`. Astro refused to start, main went red, and
 * nothing had compared the two before CI did. These are the comparisons, against workflows and
 * lockfiles invented for each case so the real ones cannot make them pass.
 */

const SOAK_2026_10_27 = `
jobs:
  browser-soak:
    name: Release Chromium Update & Heap Soak
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22.23.2
          cache: npm
      - run: npm ci
      - run: bash scripts/ci-install-fixture.sh examples/astro-payload
      - run: npm run test:soak
`;

const lock = (packages: NonNullable<Lockfile['packages']>): Lockfile => ({
  packages: { '': {}, ...packages },
});
const ASTRO_7_4_2 = lock({
  'node_modules/astro': { version: '7.4.2', engines: { node: '>=22.23.4', npm: '>=9.6.5' } },
  'node_modules/vite': { version: '8.2.2', engines: { node: '^20.19.0 || >=22.12.0' } },
});

const job = (node: string, steps: string, extra = ''): string => `
jobs:
  probe:
    runs-on: ubuntu-latest
${extra}    steps:
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: ${node}
${steps}`;

function check(
  source: string,
  lockfiles: Readonly<Record<string, Lockfile>>,
): { installs: readonly FixtureInstall[]; problems: readonly string[] } {
  const read = readInstalls('ci.yml', source);
  return {
    installs: read.installs,
    problems: [...read.problems, ...engineProblems(read.installs, lockfiles)],
  };
}

describe('the 2026-10-27 release soak', () => {
  it('is refused: Node 22.23.2 installs a lockfile whose astro needs 22.23.4', () => {
    const read = readInstalls('critical-gates.yml', SOAK_2026_10_27);
    expect(read.problems).toEqual([]);
    expect(read.installs).toEqual([
      {
        job: 'critical-gates.yml job browser-soak',
        node: '22.23.2',
        fixture: 'examples/astro-payload',
        replaced: [],
      },
    ]);

    expect(engineProblems(read.installs, { 'examples/astro-payload': ASTRO_7_4_2 })).toEqual([
      'critical-gates.yml job browser-soak runs Node 22.23.2, and examples/astro-payload locks astro@7.4.2 (node >=22.23.4)',
    ]);
  });

  it('is read whatever starts the job: a reusable workflow, a push-only condition', () => {
    // The soak runs only on pushes, called through critical-gates.yml, so no pull request
    // reached it. release/1.x met the same with astro 7.4.3 on 2026-10-28.
    const pushOnly = SOAK_2026_10_27.replace(
      '\njobs:\n  browser-soak:\n',
      "\non:\n  workflow_call: {}\njobs:\n  browser-soak:\n    if: github.event_name == 'push'\n",
    );
    expect(pushOnly).toContain("if: github.event_name == 'push'");
    const read = readInstalls('critical-gates.yml', pushOnly);
    expect(engineProblems(read.installs, { 'examples/astro-payload': ASTRO_7_4_2 })).toEqual([
      'critical-gates.yml job browser-soak runs Node 22.23.2, and examples/astro-payload locks astro@7.4.2 (node >=22.23.4)',
    ]);
  });

  it('passes on the Node the fix pinned', () => {
    const fixed = SOAK_2026_10_27.replace('node-version: 22.23.2', 'node-version: 22.23.4');
    expect(check(fixed, { 'examples/astro-payload': ASTRO_7_4_2 }).problems).toEqual([]);
  });
});

describe('which Node a job runs', () => {
  it('counts a bare major as its first release, so a floor inside the major refuses it', () => {
    expect(lowestRelease('22')).toBe('22.0.0');
    expect(lowestRelease('22.23')).toBe('22.23.0');
    expect(lowestRelease('v22.23.4')).toBe('22.23.4');
    expect(lowestRelease('22.x')).toBe('22.0.0');
    expect(
      check(job('22', '      - run: bash scripts/ci-install-fixture.sh examples/a\n'), {
        'examples/a': ASTRO_7_4_2,
      }).problems,
    ).toEqual([
      'ci.yml job probe runs Node 22 (counted as 22.0.0), and examples/a locks astro@7.4.2 (node >=22.23.4), vite@8.2.2 (node ^20.19.0 || >=22.12.0)',
    ]);
  });

  it('refuses a Node it cannot read as a release rather than guessing one', () => {
    expect(lowestRelease('lts/*')).toBeUndefined();
    expect(lowestRelease('>=22')).toBeUndefined();
    expect(
      check(job("'lts/*'", '      - run: bash scripts/ci-install-fixture.sh examples/a\n'), {
        'examples/a': ASTRO_7_4_2,
      }).problems,
    ).toEqual(['ci.yml job probe runs Node `lts/*`, which names no release this gate can read']);
  });

  it('checks every Node of a matrix, from its list and from its include rows', () => {
    const matrix = `    strategy:
      matrix:
        node: ['22.23.4']
        include:
          - node: 22.23.2
`;
    const { installs, problems } = check(
      job(
        '${{ matrix.node }}',
        '      - run: bash scripts/ci-install-fixture.sh examples/a\n',
        matrix,
      ),
      { 'examples/a': ASTRO_7_4_2 },
    );
    expect(installs.map((install) => install.node)).toEqual(['22.23.4', '22.23.2']);
    expect(problems).toEqual([
      'ci.yml job probe runs Node 22.23.2, and examples/a locks astro@7.4.2 (node >=22.23.4)',
    ]);
  });

  it('refuses a job that installs a fixture without setting up a Node', () => {
    const source = `
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/ci-install-fixture.sh examples/a
`;
    expect(readInstalls('ci.yml', source).problems).toEqual([
      'ci.yml job probe installs examples/a without actions/setup-node, on whatever Node the runner has',
    ]);
  });

  it('refuses a runner whose platform it does not know', () => {
    const source = job(
      '22.23.4',
      '      - run: bash scripts/ci-install-fixture.sh examples/a\n',
    ).replace('ubuntu-latest', 'macos-latest');
    expect(readInstalls('ci.yml', source).problems).toEqual([
      'ci.yml job probe runs on `macos-latest`; the gate knows which packages npm installs on ubuntu runners only',
    ]);
  });
});

describe('which fixture a step installs', () => {
  it('reads a fixture path from the step environment and a fromJSON map over the matrix', () => {
    const matrix = `    strategy:
      matrix:
        target: [one, two]
`;
    const steps = `      - env:
          EXAMPLE: \${{ fromJSON('{"one":"first","two":"second","three":"unused"}')[matrix.target] }}
        run: bash scripts/ci-install-fixture.sh "examples/$EXAMPLE"
`;
    expect(
      readInstalls('ci.yml', job('22.23.4', steps, matrix)).installs.map(
        (install) => install.fixture,
      ),
    ).toEqual(['examples/first', 'examples/second']);
  });

  it('refuses a fixture path it cannot resolve', () => {
    const steps = '      - run: bash scripts/ci-install-fixture.sh "examples/$UNSET"\n';
    expect(readInstalls('ci.yml', job('22.23.4', steps)).problems).toEqual([
      'ci.yml job probe installs `examples/$UNSET`, which this gate cannot resolve to a fixture',
    ]);
  });

  it('skips what an install over the lockfile replaces, and keeps what something else needs', () => {
    const steps =
      '      - run: npm --prefix examples/a install --no-audit --no-fund "astro@^${{ matrix.astro }}"\n';
    const fixture: Lockfile = {
      packages: {
        '': { dependencies: { astro: '^7', '@astrojs/node': '^10' } },
        'node_modules/astro': {
          version: '7.4.2',
          engines: { node: '>=24' },
          dependencies: { vite: '^8', 'only-astro': '1' },
        },
        'node_modules/@astrojs/node': { version: '10.0.0', dependencies: { vite: '^8' } },
        'node_modules/vite': { version: '8.2.2', engines: { node: '>=24' } },
        'node_modules/only-astro': { version: '1.0.0', engines: { node: '>=24' } },
      },
    };
    const { installs, problems } = check(job('22.23.4', steps), { 'examples/a': fixture });

    expect(installs).toEqual([
      { job: 'ci.yml job probe', node: '22.23.4', fixture: 'examples/a', replaced: ['astro'] },
    ]);
    expect(problems).toEqual([
      'ci.yml job probe runs Node 22.23.4, and examples/a locks vite@8.2.2 (node >=24)',
    ]);
  });

  it('does not count an install that ignores the lockfile, or one in the repository root', () => {
    const steps = `      - run: npm --prefix examples/a install --no-package-lock "payload@beta"
      - run: npm ci
      - run: npm install --no-save "react@18.0.0"
`;
    expect(readInstalls('ci.yml', job('22.23.4', steps))).toEqual({ installs: [], problems: [] });
  });

  it('reads an `npm ci` with a prefix, and an install in a multi-line script', () => {
    const steps = `      - run: |
          npm ci --prefix examples/a && echo done
          npm --prefix=examples/b ci
`;
    expect(
      readInstalls('ci.yml', job('22.23.4', steps)).installs.map((install) => install.fixture),
    ).toEqual(['examples/a', 'examples/b']);
  });
});

describe('installs a Playwright helper makes', () => {
  const run = (config: string, env = ''): string =>
    `      - ${env === '' ? '' : `env:\n          ${env}\n        `}run: PLP_CONTINUATION_TARBALL="$(ls "$PWD"/release-artifact/*.tgz)" npx playwright test --config ${config} --project=chromium\n`;

  it('installs the consumer the matrix selects, and the CMS beside it', () => {
    const matrix = `    strategy:
      matrix:
        astro: ['4.9.0', '7.3.2']
`;
    const steps = run(
      'playwright.astro-resources.config.ts',
      'PLP_ASTRO_RESOURCE_VERSION: ${{ matrix.astro }}',
    );
    expect(
      readInstalls('ci.yml', job('22.23.4', steps, matrix)).installs.map(
        (install) => install.fixture,
      ),
    ).toEqual([
      'tests/fixtures/payload-acl',
      'tests/fixtures/astro-resource-versions/4.9.0',
      'tests/fixtures/astro-resource-deps',
    ]);
  });

  it('takes the helper default when the step selects nothing', () => {
    expect(
      readInstalls(
        'ci.yml',
        job('22.23.4', run('playwright.astro-islands.config.ts')),
      ).installs.map((install) => install.fixture),
    ).toEqual(['tests/fixtures/payload-acl', 'tests/fixtures/astro-react-deps']);
  });

  it('refuses a selection the helper has no reviewed consumer for', () => {
    const steps = run(
      'playwright.astro-resources.config.ts',
      "PLP_ASTRO_RESOURCE_VERSION: '7.9.9'",
    );
    expect(readInstalls('ci.yml', job('22.23.4', steps)).problems).toEqual([
      'ci.yml job probe runs playwright.astro-resources.config.ts with PLP_ASTRO_RESOURCE_VERSION=7.9.9, which this gate maps to no fixture',
    ]);
  });

  it('names the consumer the helper itself selects for every version', () => {
    const resources = HARNESS_INSTALLS.find(
      (entry) => entry.config === 'playwright.astro-resources.config.ts',
    );
    const islands = HARNESS_INSTALLS.find(
      (entry) => entry.config === 'playwright.astro-islands.config.ts',
    );
    expect(resources?.select?.fixtures).toEqual(
      Object.fromEntries(
        Object.keys(resources?.select?.fixtures ?? {}).map((version) => [
          version,
          astroResourceVersion(version).dependencyRoot,
        ]),
      ),
    );
    expect(islands?.select?.fixtures).toEqual(
      Object.fromEntries(
        Object.keys(islands?.select?.fixtures ?? {}).map((version) => [
          version,
          astroResourceVersion(version, 'react-islands').dependencyRoot,
        ]),
      ),
    );
    expect(resources?.select?.default).toBe(astroResourceVersion().version);
  });
});

describe('which locked packages count', () => {
  const steps = '      - run: bash scripts/ci-install-fixture.sh examples/a\n';

  it('skips a platform package npm does not install on the runner', () => {
    const fixture = lock({
      'node_modules/@img/sharp-win32-ia32': {
        version: '0.35.5',
        optional: true,
        os: ['win32'],
        cpu: ['ia32'],
        engines: { node: '^20.9.0' },
      },
    });
    expect(check(job('22.23.4', steps), { 'examples/a': fixture }).problems).toEqual([]);
  });

  it('keeps an optional package npm would install here, because npm drops it silently on a lower Node', () => {
    const fixture = lock({
      'node_modules/@napi-rs/lzma-linux-x64-gnu': {
        version: '1.5.1',
        optional: true,
        os: ['linux'],
        cpu: ['x64'],
        libc: ['glibc'],
        engines: { node: '^22.20 || ^24.12 || >=25' },
      },
    });
    expect(check(job('24.0.0', steps), { 'examples/a': fixture }).problems).toEqual([
      'ci.yml job probe runs Node 24.0.0, and examples/a locks @napi-rs/lzma-linux-x64-gnu@1.5.1 (optional, so npm leaves it out; node ^22.20 || ^24.12 || >=25)',
    ]);
  });

  it('names five packages and counts the rest', () => {
    const fixture = lock(
      Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => [
          `node_modules/${name}`,
          { version: '1.0.0', engines: { node: '>=26' } },
        ]),
      ),
    );
    expect(check(job('24.22.1', steps), { 'examples/a': fixture }).problems).toEqual([
      'ci.yml job probe runs Node 24.22.1, and examples/a locks a@1.0.0 (node >=26), b@1.0.0 (node >=26), c@1.0.0 (node >=26), d@1.0.0 (node >=26), e@1.0.0 (node >=26) and 2 more',
    ]);
  });

  it('refuses an engines range it cannot read, and a fixture without a lockfile', () => {
    const fixture = lock({
      'node_modules/odd': { version: '1.0.0', engines: { node: '>=22.0.0-rc.1' } },
    });
    const two = `${steps}      - run: bash scripts/ci-install-fixture.sh examples/missing\n`;
    expect(check(job('22.23.4', two), { 'examples/a': fixture }).problems).toEqual([
      'examples/a locks odd@1.0.0 with engines.node `>=22.0.0-rc.1`, which this gate cannot read',
      'ci.yml job probe installs examples/missing, which has no package-lock.json',
    ]);
  });
});

describe('reading an engines range', () => {
  it.each([
    ['22.23.4', '>=22.23.4', true],
    ['22.23.3', '>=22.23.4', false],
    ['22.0.0', '^20.19.0 || >=22.12.0', false],
    ['22.12.0', '^20.19.0 || >=22.12.0', true],
    ['20.18.9', '^20.19.0 || >=22.12.0', false],
    ['21.0.0', '^20.19.0 || >=22.12.0', false],
    ['22.23.4', '^22.23.4 || >=24.22.1', true],
    ['24.0.0', '^22.23.4 || >=24.22.1', false],
    ['24.22.1', '^22.23.4 || >=24.22.1', true],
    ['22.0.0', '>= 12.0.0', true],
    ['22.0.0', '>=v12.22.0', true],
    ['22.0.0', '>=22', true],
    ['21.9.9', '>=22', false],
    ['22.0.0', '>22', false],
    ['23.0.0', '>22', true],
    ['22.13.0', '>22.12', true],
    ['22.12.9', '>22.12', false],
    ['22.0.0', '<22', false],
    ['22.99.0', '<=22', true],
    ['18.20.8', '18.20.8 || ^20.3.0 || >=22.0.0', true],
    ['18.20.7', '18.20.8 || ^20.3.0 || >=22.0.0', false],
    ['14.17.0', '14 >=14.17 || 16 >=16.14 || >=18', true],
    ['14.16.0', '14 >=14.17 || 16 >=16.14 || >=18', false],
    ['22.23.4', '~22.23.0', true],
    ['22.24.0', '~22.23.0', false],
    ['0.10.5', '^0.10.0', true],
    ['0.11.0', '^0.10.0', false],
    ['20.5.0', '20.x', true],
    ['22.0.0', '*', true],
    ['22.0.0', '', true],
    ['22.5.0', '20 - 22.5', true],
    ['22.6.0', '20 - 22.5', false],
    ['19.9.9', '20 - 22.5', false],
    ['22.0.0', '>=18.0.0 <23', true],
    ['23.0.0', '>=18.0.0 <23', false],
  ] as const)('%s against `%s` is %s', (version, range, expected) => {
    expect(satisfies(version, range)).toBe(expected);
  });

  it.each(['>=22.0.0-rc.1', 'node 22', '>=22.0.0 || latest', '22.0.0.1'])(
    'does not read `%s`',
    (range) => {
      expect(satisfies('22.0.0', range)).toBeUndefined();
    },
  );
});
