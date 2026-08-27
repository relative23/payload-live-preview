/**
 * The README compatibility table, generated from `quality/compat-matrix.json`
 * and validated against what CI runs (roadmap 1.4.0).
 *
 * - `--write` renders the table into the README between its markers.
 * - `--check` fails when the README block differs from the rendering, when a
 *   lockfile-sourced version differs from the fixture's lockfile, when the
 *   Node matrix differs from the workflow, or when the Astro majors differ
 *   from the workflow's matrix job — so a hand edit, or a fixture upgrade
 *   without a matrix update, fails the build.
 *
 * @module scripts/compat-table
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
}
interface Framework {
  readonly name: string;
  readonly package: string;
  readonly supported: string;
  readonly fixture: string;
  readonly tested: readonly Tested[];
}
interface Matrix {
  readonly frameworks: readonly Framework[];
  readonly node: {
    readonly engines: string;
    readonly tested: readonly number[];
    readonly job: string;
  };
  readonly payload: readonly { readonly version: string; readonly how: string }[];
}

function label(entry: Tested): string {
  const what = entry.version ?? `${String(entry.major)}.x`;
  return `${what} (${entry.browsers.join(', ')})`;
}

export function render(matrix: Matrix): string {
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
    ...payload,
    '',
    END,
  ].join('\n');
}

async function lockfileVersion(fixture: string, name: string): Promise<string | undefined> {
  const lock = JSON.parse(await readFile(resolve(ROOT, fixture, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>;
  };
  return lock.packages?.[`node_modules/${name}`]?.version;
}

function workflowList(workflow: string, key: string): readonly string[] {
  const match = new RegExp(`^\\s*${key}: \\[([^\\]]*)\\]`, 'mu').exec(workflow);
  if (match?.[1] === undefined) return [];
  return match[1].split(',').map((item) => item.trim());
}

async function validate(matrix: Matrix): Promise<readonly string[]> {
  const problems: string[] = [];
  const workflow = await readFile(WORKFLOW, 'utf8');
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
  const workflowAstro = workflowList(workflow, 'astro');
  if (astroMajors.join(',') !== workflowAstro.join(',')) {
    problems.push(
      `Astro matrix: file lists [${astroMajors.join(', ')}], workflow runs [${workflowAstro.join(', ')}]`,
    );
  }
  const workflowNode = workflowList(workflow, 'node');
  if (matrix.node.tested.map(String).join(',') !== workflowNode.join(',')) {
    problems.push(
      `Node matrix: file lists [${matrix.node.tested.join(', ')}], workflow runs [${workflowNode.join(', ')}]`,
    );
  }
  return problems;
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
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: compat-table.ts --write | --check');
  }
  const matrix = JSON.parse(await readFile(MATRIX, 'utf8')) as Matrix;
  const problems = [...(await validate(matrix))];
  const readme = await readFile(README, 'utf8');
  const block = render(matrix);
  const next = replaceBlock(readme, block);
  if (mode === '--write') {
    if (next !== readme) await writeFile(README, next, 'utf8');
    console.log(`compat-table: README ${next === readme ? 'unchanged' : 'updated'}`);
  } else if (next !== readme) {
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
