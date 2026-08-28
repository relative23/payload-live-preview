/**
 * The README compatibility table, rendered from `quality/compat-matrix.json`
 * and held against the fixture lockfiles and the CI matrices.
 * `--write` updates the README block; `--check` fails on any drift.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matrixValues, parseWorkflow } from './workflow-contracts';

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
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: compat-table.ts --write | --check');
  }
  const matrix = JSON.parse(await readFile(MATRIX, 'utf8')) as Matrix;
  const problems = [...(await validate(matrix))];
  const readme = await readFile(README, 'utf8');
  const block = render(matrix);
  const next = replaceBlock(readme, block);
  const same = normalize(next) === normalize(readme);
  if (mode === '--write') {
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
