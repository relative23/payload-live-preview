/**
 * Every package a fixture lockfile installs, held against the Node of every CI job that installs
 * that fixture, in every workflow and whatever starts the job. On 2026-10-27 the push-only release
 * soak ran Node 22.23.2 and served the Astro fixture, whose lockfile pins astro 7.4.2 with
 * `engines.node >=22.23.4`; Astro refused to start, and nothing had compared the two before CI did.
 * A bare `node-version: 22` floats with the runner image, so it counts as 22.0.0. Whatever this file
 * cannot read fails the check.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { installsOn, type LockEntry, type Platform } from './check-platform-packages';
import { lowestRelease, satisfies } from './compat-engines-range';

export interface LockPackage extends LockEntry {
  readonly name?: string;
  readonly optional?: boolean;
  readonly link?: boolean;
  readonly resolved?: string;
  readonly engines?: unknown;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export interface Lockfile {
  readonly packages?: Readonly<Record<string, LockPackage>>;
}

/** One CI job installing one fixture lockfile on one Node. */
export interface FixtureInstall {
  /** `<workflow file> job <id>`, for the message. */
  readonly job: string;
  /** The Node the job runs, as `actions/setup-node` was given it. */
  readonly node: string;
  /** The directory that holds the lockfile, relative to the repository. */
  readonly fixture: string;
  /** Packages the step installs over the lockfile. */
  readonly replaced: readonly string[];
}

/** A Playwright config whose helper copies a reviewed consumer and runs `npm ci` on its lock. */
export interface HarnessInstall {
  readonly config: string;
  /** Installed whatever the selection. */
  readonly fixtures: readonly string[];
  /** The consumer the helper picks by an environment variable, when it picks one. */
  readonly select?: {
    readonly env: string;
    readonly default: string;
    readonly fixtures: Readonly<Record<string, string>>;
  };
}

/**
 * The helpers behind these configs: `tests/e2e/helpers/astro-floor-base.ts`, and
 * `native-continuation.ts`, which installs the ACL fixture as its CMS beside a consumer: the
 * one `astro-resource-versions.ts` selects, or the example of the framework the config names.
 * A unit test holds the selections to that helper.
 */
export const HARNESS_INSTALLS: readonly HarnessInstall[] = [
  {
    config: 'playwright.astro-floor-base.config.ts',
    fixtures: ['tests/fixtures/astro-floor-base-deps'],
  },
  {
    config: 'playwright.astro-islands.config.ts',
    fixtures: ['tests/fixtures/payload-acl'],
    select: {
      env: 'PLP_ASTRO_RESOURCE_VERSION',
      default: '7.3.2',
      fixtures: {
        '4.16.19': 'tests/fixtures/astro-react-versions/4.16.19',
        '7.3.2': 'tests/fixtures/astro-react-deps',
      },
    },
  },
  {
    config: 'playwright.astro-resources.config.ts',
    fixtures: ['tests/fixtures/payload-acl'],
    select: {
      env: 'PLP_ASTRO_RESOURCE_VERSION',
      default: '7.3.2',
      fixtures: {
        '4.9.0': 'tests/fixtures/astro-resource-versions/4.9.0',
        '4.16.19': 'tests/fixtures/astro-resource-versions/4.16.19',
        '5.18.2': 'tests/fixtures/astro-resource-versions/5.18.2',
        '6.4.8': 'tests/fixtures/astro-resource-versions/6.4.8',
        '7.3.2': 'tests/fixtures/astro-resource-deps',
        '7.4.4': 'tests/fixtures/astro-resource-versions/7.4.4',
      },
    },
  },
  {
    config: 'playwright.next-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'examples/nextjs-payload'],
  },
  {
    config: 'playwright.sveltekit-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'examples/sveltekit-payload'],
  },
  {
    config: 'playwright.nuxt-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'examples/nuxt-payload'],
  },
  {
    config: 'playwright.html-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'examples/pure-html'],
  },
  {
    config: 'playwright.vue-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'tests/fixtures/vue-host-deps'],
  },
  {
    config: 'playwright.react-continuation.config.ts',
    fixtures: ['tests/fixtures/payload-acl', 'tests/fixtures/react-host-deps'],
  },
];

/** What `ubuntu-latest` and `ubuntu-<version>` run: npm installs the packages that admit this. */
const UBUNTU: Platform = { os: 'linux', cpu: 'x64', libc: 'glibc' };
const UBUNTU_RUNNER = /^ubuntu-(?:latest|\d+\.\d+)$/u;
const NAMED = 5;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Workflows ---------------------------------------------------------------------------------

/** Shell words per command; quotes are removed and a `${{ … }}` expression stays one word. */
function commands(script: string): readonly (readonly string[])[] {
  const found: string[][] = [[]];
  let word: string | undefined;
  let quote: string | undefined;
  const close = (): void => {
    if (word !== undefined) found.at(-1)?.push(word);
    word = undefined;
  };
  for (let index = 0; index < script.length; index++) {
    const char = script[index] ?? '';
    if (script.startsWith('${{', index)) {
      const end = script.indexOf('}}', index);
      const stop = end === -1 ? script.length : end + 2;
      word = (word ?? '') + script.slice(index, stop);
      index = stop - 1;
    } else if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else word = (word ?? '') + char;
    } else if (char === '"' || char === "'") {
      quote = char;
      word ??= '';
    } else if (char === '\\' && script[index + 1] === '\n') {
      index++;
    } else if (/[\n;&|]/u.test(char)) {
      close();
      if ((found.at(-1)?.length ?? 0) > 0) found.push([]);
    } else if (/\s/u.test(char)) {
      close();
    } else {
      word = (word ?? '') + char;
    }
  }
  close();
  return found.filter((command) => command.length > 0);
}

interface Scope {
  readonly env: (name: string) => string | undefined;
  readonly matrix: (key: string) => readonly string[] | undefined;
}

/** Every value a workflow string takes over the job's matrix, or undefined when it cannot be told. */
function expand(text: string, scope: Scope): readonly string[] | undefined {
  const variable = /\$(?:\{(\w+)\}|(\w+))/gu;
  const names = [...text.matchAll(variable)].map((match) => match[1] ?? match[2] ?? '');
  if (names.some((name) => scope.env(name) === undefined)) return undefined;
  const substituted = text.replace(
    variable,
    (_, braced?: string, bare?: string) => scope.env(braced ?? bare ?? '') ?? '',
  );
  let values: readonly string[] = [''];
  let rest = substituted;
  for (
    let match = /\$\{\{(.*?)\}\}/u.exec(rest);
    match !== null;
    match = /\$\{\{(.*?)\}\}/u.exec(rest)
  ) {
    const options = expression((match[1] ?? '').trim(), scope);
    if (options === undefined) return undefined;
    const prefix = rest.slice(0, match.index);
    values = values.flatMap((value) => options.map((option) => value + prefix + option));
    rest = rest.slice(match.index + match[0].length);
  }
  return values.map((value) => value + rest);
}

/** `matrix.<key>` and `fromJSON('<object>')[matrix.<key>]`, the two forms the workflows use. */
function expression(text: string, scope: Scope): readonly string[] | undefined {
  const direct = /^matrix\.([\w-]+)$/u.exec(text);
  if (direct !== null) return scope.matrix(direct[1] ?? '');
  const lookup = /^fromJSON\('(.*)'\)\[matrix\.([\w-]+)\]$/su.exec(text);
  if (lookup === null) return undefined;
  const table: unknown = JSON.parse(lookup[1] ?? '');
  const keys = scope.matrix(lookup[2] ?? '');
  if (!isRecord(table) || keys === undefined) return undefined;
  const values = keys.map((key) => table[key]);
  return values.every((value) => typeof value === 'string') ? values : undefined;
}

function matrixOf(job: JsonRecord): (key: string) => readonly string[] | undefined {
  const strategy = isRecord(job['strategy']) ? job['strategy'] : {};
  const matrix = isRecord(strategy['matrix']) ? strategy['matrix'] : {};
  return (key) => {
    const listed = Array.isArray(matrix[key]) ? (matrix[key] as unknown[]) : [];
    const rows = Array.isArray(matrix['include']) ? (matrix['include'] as unknown[]) : [];
    const values = [...listed, ...rows.filter(isRecord).map((row) => row[key])].filter(
      (value): value is string => typeof value === 'string',
    );
    return values.length === 0 ? undefined : [...new Set(values)];
  };
}

function strings(value: unknown): Readonly<Record<string, string>> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
}

/** The package an install spec names: `astro@^6` is astro, `@scope/name@1` is @scope/name. */
function specName(spec: string): string {
  const at = spec.indexOf('@', 1);
  return at === -1 ? spec : spec.slice(0, at);
}

interface Found {
  readonly fixture: string;
  readonly replaced: readonly string[];
}

/**
 * What one command installs: a fixture path still to expand, nothing, or a harness config. A job
 * installs a fixture through `scripts/ci-install-fixture.sh`, through `npm ci` or `npm install` with
 * `--prefix` (an install over the lockfile re-resolves the packages it names and whatever only they
 * pull in), or through a Playwright helper in `HARNESS_INSTALLS`. Without `--prefix` it is the
 * repository root, which is not a fixture: the unit job installs it on Node 20 on purpose.
 */
function installOf(
  words: readonly string[],
  scripts: Readonly<Record<string, string>>,
): { readonly path?: string; readonly replaced?: readonly string[]; readonly config?: string } {
  const assignment = /^\w+=/u;
  const command = words.slice(words.findIndex((word) => !assignment.test(word)));
  const [program, ...rest] = command;
  if (program === 'bash' && rest[0] === 'scripts/ci-install-fixture.sh' && rest[1] !== undefined) {
    return { path: rest[1], replaced: [] };
  }
  const configAt = command.indexOf('--config');
  const config =
    configAt === -1
      ? command.find((word) => word.startsWith('--config='))?.slice('--config='.length)
      : command[configAt + 1];
  if (command.includes('playwright') && config !== undefined) return { config };
  if (program !== 'npm') return {};
  const positional: string[] = [];
  let prefix: string | undefined;
  for (let index = 0; index < rest.length; index++) {
    const word = rest[index] ?? '';
    if (word === '--prefix' || word === '-C') prefix = rest[++index];
    else if (word.startsWith('--prefix=')) prefix = word.slice('--prefix='.length);
    else if (!word.startsWith('-')) positional.push(word);
  }
  const [verb, ...specs] = positional;
  if (verb === 'run' && specs[0] !== undefined && scripts[specs[0]] !== undefined) {
    return (
      commands(scripts[specs[0]] ?? '')
        .map((script) => installOf(script, {}))
        .find((found) => found.config !== undefined) ?? {}
    );
  }
  const lockless = rest.includes('--no-package-lock') || rest.includes('--package-lock=false');
  if (prefix === undefined || lockless) return {};
  if (verb === 'ci') return { path: prefix, replaced: [] };
  if (verb === 'install' || verb === 'i' || verb === 'add') {
    return { path: prefix, replaced: specs.map(specName) };
  }
  return {};
}

/** The fixtures a harness config installs for one command, and the selections it cannot map. */
function harnessFixtures(
  entry: HarnessInstall,
  words: readonly string[],
  scope: Scope,
): { readonly fixtures: readonly string[]; readonly unmapped: readonly string[] } {
  const select = entry.select;
  if (select === undefined) return { fixtures: entry.fixtures, unmapped: [] };
  // A selection set on the command line wins over the step's environment, as in the shell.
  const assigned = words.find((word) => word.startsWith(`${select.env}=`));
  const written = assigned?.slice(select.env.length + 1) ?? scope.env(select.env);
  const values = written === undefined ? [select.default] : (expand(written, scope) ?? [written]);
  const fixtures = [...entry.fixtures];
  const unmapped: string[] = [];
  for (const value of values) {
    const fixture = select.fixtures[value];
    if (fixture === undefined) unmapped.push(value);
    else fixtures.push(fixture);
  }
  return { fixtures, unmapped };
}

/**
 * Every fixture a workflow's jobs install, with the Node each job runs. Problems name what this
 * file cannot read in a job that installs a fixture.
 */
export function readInstalls(
  file: string,
  source: string,
  scripts: Readonly<Record<string, string>> = {},
  harness: readonly HarnessInstall[] = HARNESS_INSTALLS,
): { readonly installs: readonly FixtureInstall[]; readonly problems: readonly string[] } {
  // The failsafe schema keeps every scalar a string: `node-version: 22.10` stays 22.10.
  const document: unknown = parse(source, { schema: 'failsafe' });
  const workflowEnv = isRecord(document) ? strings(document['env']) : {};
  const jobs = isRecord(document) && isRecord(document['jobs']) ? document['jobs'] : {};
  const installs: FixtureInstall[] = [];
  const problems: string[] = [];
  for (const [id, job] of Object.entries(jobs)) {
    if (!isRecord(job) || !Array.isArray(job['steps'])) continue;
    const label = `${file} job ${id}`;
    const matrix = matrixOf(job);
    const jobEnv = { ...workflowEnv, ...strings(job['env']) };
    const found: Found[] = [];
    let nodes: readonly string[] | undefined;
    let setup = false;
    for (const step of job['steps'].filter(isRecord)) {
      const env = { ...jobEnv, ...strings(step['env']) };
      const scope: Scope = { env: (name) => env[name], matrix };
      if (typeof step['uses'] === 'string' && step['uses'].startsWith('actions/setup-node@')) {
        setup = true;
        const written = strings(step['with'])['node-version'];
        nodes = written === undefined ? undefined : expand(written, scope);
      }
      if (typeof step['run'] !== 'string') continue;
      for (const words of commands(step['run'])) {
        const install = installOf(words, scripts);
        if (install.path !== undefined) {
          const paths = expand(install.path, scope);
          if (paths === undefined) {
            problems.push(
              `${label} installs \`${install.path}\`, which this gate cannot resolve to a fixture`,
            );
          }
          for (const path of paths ?? []) {
            found.push({ fixture: path, replaced: install.replaced ?? [] });
          }
        }
        if (install.config === undefined) continue;
        // A matrix job may name its config through the matrix: each value is one helper's install.
        const configs = expand(install.config, scope);
        if (configs === undefined) {
          problems.push(
            `${label} runs \`${install.config}\`, which this gate cannot resolve to a config`,
          );
        }
        for (const config of configs ?? []) {
          const entry = harness.find((candidate) => candidate.config === config);
          if (entry === undefined) continue;
          const selected = harnessFixtures(entry, words, { env: (name) => env[name], matrix });
          found.push(...selected.fixtures.map((fixture) => ({ fixture, replaced: [] })));
          problems.push(
            ...selected.unmapped.map(
              (value) =>
                `${label} runs ${entry.config} with ${entry.select?.env ?? ''}=${value}, which this gate maps to no fixture`,
            ),
          );
        }
      }
    }
    if (found.length === 0) continue;
    const runsOn = job['runs-on'];
    if (typeof runsOn !== 'string' || !UBUNTU_RUNNER.test(runsOn)) {
      problems.push(
        `${label} runs on \`${String(runsOn)}\`; the gate knows which packages npm installs on ubuntu runners only`,
      );
      continue;
    }
    if (!setup) {
      for (const fixture of new Set(found.map((entry) => entry.fixture))) {
        problems.push(
          `${label} installs ${fixture} without actions/setup-node, on whatever Node the runner has`,
        );
      }
      continue;
    }
    if (nodes === undefined) {
      problems.push(`${label} sets a node-version this gate cannot resolve over its matrix`);
      continue;
    }
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const { fixture, replaced } of found) {
        const key = [node, fixture, ...replaced].join('\u0000');
        if (seen.has(key)) continue;
        seen.add(key);
        installs.push({ job: label, node, fixture, replaced });
      }
    }
  }
  return { installs, problems };
}

// --- Lockfiles ---------------------------------------------------------------------------------

/** Node's lookup from a lockfile path: its own node_modules first, then each parent's, then the top. */
function resolveEdge(
  from: string,
  name: string,
  packages: Readonly<Record<string, LockPackage>>,
): string | undefined {
  for (let base = from; ;) {
    const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate] !== undefined) return candidate;
    if (base === '') return undefined;
    const at = base.lastIndexOf('/node_modules/');
    base = at === -1 ? '' : base.slice(0, at);
  }
}

/** The lockfile paths an install leaves as locked: all of them, or what the root reaches without `replaced`. */
function lockedPaths(
  packages: Readonly<Record<string, LockPackage>>,
  replaced: readonly string[],
): readonly string[] {
  if (replaced.length === 0) return Object.keys(packages).filter((path) => path !== '');
  const reached = new Set<string>();
  const queue = [''];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    const entry = packages[path];
    if (entry === undefined) continue;
    const target = entry.link === true ? entry.resolved : undefined;
    if (target !== undefined && !reached.has(target)) {
      reached.add(target);
      queue.push(target);
    }
    const names = [
      entry.dependencies,
      entry.devDependencies,
      entry.optionalDependencies,
      entry.peerDependencies,
    ]
      .flatMap((group) => Object.keys(group ?? {}))
      .filter((name) => !replaced.includes(name));
    for (const name of names) {
      const next = resolveEdge(path, name, packages);
      if (next === undefined || reached.has(next)) continue;
      reached.add(next);
      queue.push(next);
    }
  }
  return Object.keys(packages).filter((path) => reached.has(path));
}

function packageName(path: string, entry: LockPackage): string {
  const at = path.lastIndexOf('node_modules/');
  return entry.name ?? (at === -1 ? path : path.slice(at + 'node_modules/'.length));
}

/**
 * Every install whose Node a locked package refuses, and every range or file this file cannot read.
 * A package npm leaves out on the runner (another `os`, `cpu` or `libc`) does not count; an optional
 * one for this runner does, because npm drops it without an error when its engines refuse the Node.
 */
export function engineProblems(
  installs: readonly FixtureInstall[],
  lockfiles: Readonly<Record<string, Lockfile | undefined>>,
  platform: Platform = UBUNTU,
): readonly string[] {
  const problems = new Set<string>();
  for (const install of installs) {
    const floor = lowestRelease(install.node);
    if (floor === undefined) {
      problems.add(
        `${install.job} runs Node \`${install.node}\`, which names no release this gate can read`,
      );
      continue;
    }
    const packages = lockfiles[install.fixture]?.packages;
    if (packages === undefined) {
      problems.add(`${install.job} installs ${install.fixture}, which has no package-lock.json`);
      continue;
    }
    const refused: string[] = [];
    for (const path of lockedPaths(packages, install.replaced)) {
      const entry = packages[path];
      if (entry === undefined || !installsOn(path, packages, platform)) continue;
      const range = isRecord(entry.engines) ? entry.engines['node'] : undefined;
      if (range === undefined) continue;
      const pkg = `${packageName(path, entry)}@${entry.version ?? '?'}`;
      const text = typeof range === 'string' ? range : JSON.stringify(range);
      const answer = typeof range === 'string' ? satisfies(floor, range) : undefined;
      if (answer === undefined) {
        problems.add(
          `${install.fixture} locks ${pkg} with engines.node \`${text}\`, which this gate cannot read`,
        );
      } else if (!answer) {
        const optional = entry.optional === true ? 'optional, so npm leaves it out; ' : '';
        refused.push(`${pkg} (${optional}node ${text})`);
      }
    }
    if (refused.length === 0) continue;
    const named = refused.slice(0, NAMED).join(', ');
    const more = refused.length > NAMED ? ` and ${String(refused.length - NAMED)} more` : '';
    const counted = floor === install.node ? '' : ` (counted as ${floor})`;
    problems.add(
      `${install.job} runs Node ${install.node}${counted}, and ${install.fixture} locks ${named}${more}`,
    );
  }
  return [...problems];
}

/** The check `compat:check` runs: every workflow under `.github/workflows`, every lockfile they install. */
export async function checkEngines(root: string): Promise<{
  readonly installs: readonly FixtureInstall[];
  readonly problems: readonly string[];
}> {
  const directory = resolve(root, '.github/workflows');
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const installs: FixtureInstall[] = [];
  const problems: string[] = [];
  for (const file of (await readdir(directory)).filter((name) => /\.ya?ml$/u.test(name)).sort()) {
    const read = readInstalls(
      file,
      await readFile(join(directory, file), 'utf8'),
      manifest.scripts,
    );
    installs.push(...read.installs);
    problems.push(...read.problems);
  }
  const lockfiles: Record<string, Lockfile | undefined> = {};
  for (const fixture of new Set(installs.map((install) => install.fixture))) {
    try {
      lockfiles[fixture] = JSON.parse(
        await readFile(resolve(root, fixture, 'package-lock.json'), 'utf8'),
      ) as Lockfile;
    } catch {
      // engineProblems names the fixture that has none.
    }
  }
  return { installs, problems: [...problems, ...engineProblems(installs, lockfiles)] };
}
