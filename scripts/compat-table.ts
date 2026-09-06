/**
 * The README compatibility table, rendered from `quality/compat-matrix.json`
 * and held against the fixture lockfiles and the CI matrices.
 * `--write` updates the README block; `--check` fails on any drift.
 */
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matrixValues, parseWorkflow } from './workflow-contracts';
import {
  peerCoverageProblems,
  renderViteLine,
  viteProblems,
  type RecordedVite,
  type ViteFacts,
} from './compat-vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MATRIX = resolve(ROOT, 'quality/compat-matrix.json');
const README = resolve(ROOT, 'README.md');
const WORKFLOW = resolve(ROOT, '.github/workflows/ci.yml');
const START = '<!-- compat-matrix:start -->';
const END = '<!-- compat-matrix:end -->';

interface Tested {
  readonly version?: string;
  readonly major?: number;
  readonly source: 'lockfile' | 'astro-matrix';
  readonly browsers: readonly string[];
  readonly job: string;
  /** The Vite range this framework version declares; absent for a framework that has none. */
  vite?: string;
}
interface Framework {
  readonly name: string;
  readonly package: string;
  readonly supported: string;
  readonly fixture: string;
  readonly tested: readonly Tested[];
  /** Where the framework's Vite range is declared; absent for a framework without one. */
  readonly vite?: { readonly from: string; readonly field: 'dependencies' | 'peerDependencies' };
}
interface Matrix {
  readonly frameworks: readonly Framework[];
  readonly vite?: { readonly measured: string };
  readonly node: {
    readonly engines: string;
    readonly tested: readonly number[];
    readonly job: string;
  };
  readonly payload: readonly {
    readonly version: string;
    readonly how: string;
    readonly source?: 'tests' | 'corpus' | 'watch';
  }[];
}

function label(entry: Tested): string {
  const what = entry.version ?? `${String(entry.major)}.x`;
  return `${what} (${entry.browsers.join(', ')})`;
}

export function render(matrix: Matrix, viteLine = ''): string {
  const rows = matrix.frameworks.map(
    (framework) =>
      `| ${framework.name} | ${framework.supported} | ${framework.tested.map(label).join('; ')} |`,
  );
  const payload = matrix.payload.map((entry) => `- Payload ${entry.version}: ${entry.how}.`);
  return [
    START,
    '',
    '| Framework | Supported | Tested in CI on every push (version, browsers) |',
    '| --- | --- | --- |',
    ...rows,
    '',
    `Node ${matrix.node.engines}; the unit and integration suites run on Node ${matrix.node.tested.join(', ')}. Every version in the table is what the fixture lockfile or the matrix job installs, checked by \`npm run compat:check\`.`,
    '',
    ...(viteLine === '' ? [] : [viteLine, '']),
    ...payload,
    '',
    END,
  ].join('\n');
}

/** What the record says each supported framework major installs. */
function recordedVite(matrix: Matrix): readonly RecordedVite[] {
  return matrix.frameworks.flatMap((framework) =>
    framework.tested.flatMap((entry) => {
      if (entry.vite === undefined) return [];
      const major = entry.major ?? Number(entry.version?.split('.')[0]);
      return [{ framework: framework.name, major, range: entry.vite }];
    }),
  );
}

/** Every fixture lockfile that installs Vite at all, and at which version. */
async function viteLockfiles(
  matrix: Matrix,
): Promise<readonly { readonly fixture: string; readonly version: string }[]> {
  const found: { fixture: string; version: string }[] = [];
  for (const fixture of new Set(matrix.frameworks.map((framework) => framework.fixture))) {
    const version = await lockfileVersion(fixture, 'vite');
    if (version !== undefined) found.push({ fixture, version });
  }
  return found;
}

async function viteFacts(matrix: Matrix): Promise<ViteFacts> {
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
    devDependencies?: Record<string, string>;
  };
  return {
    recorded: recordedVite(matrix),
    dev: manifest.devDependencies?.['vite'] ?? '',
    lockfiles: await viteLockfiles(matrix),
  };
}

const run = promisify(execFile);

/**
 * The one place this file reaches the network. `--check` never calls it: a gate
 * that needs the registry is a gate that fails on a plane, and the question it
 * answers — does the record still match the repository — is answerable offline.
 */
async function declaredVite(
  spec: string,
  field: 'dependencies' | 'peerDependencies',
): Promise<string | undefined> {
  const { stdout } = await run('npm', ['view', spec, `${field}.vite`, '--json'], {
    encoding: 'utf8',
  });
  const parsed: unknown = JSON.parse(stdout.trim() === '' ? 'null' : stdout);
  // A range that matches several published versions answers with a list, newest last.
  const value: unknown = Array.isArray(parsed) ? (parsed as readonly unknown[]).at(-1) : parsed;
  return typeof value === 'string' ? value : undefined;
}

/** Re-read what each supported framework major installs, and stamp the date. */
async function refresh(matrix: Matrix): Promise<Matrix> {
  for (const framework of matrix.frameworks) {
    if (framework.vite === undefined) continue;
    for (const entry of framework.tested) {
      // `@nuxt/vite-builder` ships in lockstep with Nuxt, so the framework's
      // own version is the version to ask about even when the package differs.
      const version = entry.version ?? `^${String(entry.major)}`;
      const spec = `${framework.vite.from}@${version}`;
      const range = await declaredVite(spec, framework.vite.field);
      if (range === undefined) {
        console.warn(`compat-table: ${spec} declares no vite in ${framework.vite.field}`);
        continue;
      }
      if (entry.vite !== range) console.log(`compat-table: ${spec} → ${range}`);
      entry.vite = range;
    }
  }
  return { ...matrix, vite: { measured: new Date().toISOString().slice(0, 10) } };
}

async function lockfileVersion(fixture: string, name: string): Promise<string | undefined> {
  const lock = JSON.parse(await readFile(resolve(ROOT, fixture, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  return lock.packages?.[`node_modules/${name}`]?.version;
}

async function validate(matrix: Matrix): Promise<readonly string[]> {
  const problems: string[] = [];
  const workflow = parseWorkflow(await readFile(WORKFLOW, 'utf8'));
  for (const framework of matrix.frameworks) {
    for (const entry of framework.tested) {
      if (entry.source === 'lockfile') {
        const actual = await lockfileVersion(framework.fixture, framework.package);
        if (actual !== entry.version) {
          problems.push(
            `${framework.name}: matrix says ${String(entry.version)}, ${framework.fixture} lockfile has ${String(actual)}`,
          );
        }
      }
    }
  }
  const astroMajors =
    matrix.frameworks
      .find((framework) => framework.package === 'astro')
      ?.tested.filter((entry) => entry.source === 'astro-matrix')
      .map((entry) => String(entry.major)) ?? [];
  const workflowAstro = matrixValues(workflow, 'astro-matrix', 'astro').map(String);
  if (astroMajors.join(',') !== workflowAstro.join(',')) {
    problems.push(
      `Astro matrix: file lists [${astroMajors.join(', ')}], workflow runs [${workflowAstro.join(', ')}]`,
    );
  }
  const corpusVersions = (await readdir(resolve(ROOT, 'tests/fixtures/wire-corpus')))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.replace(/^payload-/u, '').replace(/\.json$/u, ''))
    .sort();
  const listedCorpus = matrix.payload
    .filter((entry) => entry.source === 'corpus')
    .map((entry) => entry.version)
    .sort();
  if (corpusVersions.join(',') !== listedCorpus.join(',')) {
    problems.push(
      `Payload corpus: files cover [${corpusVersions.join(', ')}], matrix lists [${listedCorpus.join(', ')}]`,
    );
  }
  const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
    peerDependencies?: Record<string, string>;
  };
  problems.push(
    ...peerCoverageProblems(
      matrix.frameworks.map((framework) => ({
        name: framework.name,
        package: framework.package,
        majors: framework.tested.map(
          (entry) => entry.major ?? Number(entry.version?.split('.')[0]),
        ),
      })),
      manifest.peerDependencies ?? {},
    ),
  );
  problems.push(...viteProblems(await viteFacts(matrix)));

  const workflowNode = matrixValues(workflow, 'unit', 'node').map(String);
  if (matrix.node.tested.map(String).join(',') !== workflowNode.join(',')) {
    problems.push(
      `Node matrix: file lists [${matrix.node.tested.join(', ')}], workflow runs [${workflowNode.join(', ')}]`,
    );
  }
  return problems;
}

// Prettier re-pads table cells after `--write`; compare content, not alignment.
function normalize(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\s*\|\s*/gu, '|')
        .replace(/-{3,}/gu, '---')
        .trimEnd(),
    )
    .join('\n');
}

function replaceBlock(readme: string, block: string): string {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`README.md lacks the ${START} … ${END} markers`);
  }
  return readme.slice(0, start) + block + readme.slice(end + END.length);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check' && mode !== '--refresh') {
    throw new Error('usage: compat-table.ts --write | --check | --refresh');
  }
  const recorded = JSON.parse(await readFile(MATRIX, 'utf8')) as Matrix;
  const matrix = mode === '--refresh' ? await refresh(recorded) : recorded;
  if (mode === '--refresh') {
    await writeFile(MATRIX, `${JSON.stringify(matrix, undefined, 2)}\n`, 'utf8');
    console.log('compat-table: quality/compat-matrix.json refreshed; read the diff');
  }
  const problems = [...(await validate(matrix))];
  const readme = await readFile(README, 'utf8');
  const block = render(
    matrix,
    matrix.vite === undefined ? '' : renderViteLine(await viteFacts(matrix), matrix.vite.measured),
  );
  const next = replaceBlock(readme, block);
  const same = normalize(next) === normalize(readme);
  if (mode === '--write' || mode === '--refresh') {
    if (!same) await writeFile(README, next, 'utf8');
    console.log(`compat-table: README ${same ? 'unchanged' : 'updated (run npm run format)'}`);
  } else if (!same) {
    problems.push(
      'README compatibility block differs from quality/compat-matrix.json; run npm run compat:write',
    );
  }
  for (const problem of problems) console.error(`FAIL ${problem}`);
  if (problems.length > 0) throw new Error(`compat-table: ${String(problems.length)} problem(s)`);
  if (mode === '--check') {
    console.log('compat-table: README block and CI matrix agree with quality/compat-matrix.json');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
