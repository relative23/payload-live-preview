/**
 * The committed test inventory: every test file is scanned, grouped by the
 * runner that owns it, and counted. A stale or policy-dirty inventory fails,
 * so a skipped or focused declaration cannot be added without review.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  analyzeTestSource,
  RUNNER_CONFIGS,
  TEST_FILE_PATTERN,
  type TestGroup,
  type TestPolicyViolation,
} from './test-policy-scanner';

export interface TestInventoryFile {
  readonly path: string;
  readonly group: TestGroup;
  readonly suites: number;
  readonly tests: number;
  readonly benchmarks: number;
}

export interface TestInventoryGroup {
  readonly files: number;
  readonly suites: number;
  readonly tests: number;
  readonly benchmarks: number;
}

export interface TestInventory {
  readonly schemaVersion: 1;
  readonly policy: {
    readonly focused: 0;
    readonly skipped: 0;
    readonly todo: 0;
    readonly expectedFailure: 0;
  };
  readonly runnerConfigs: readonly string[];
  readonly totals: TestInventoryGroup;
  readonly groups: Readonly<Record<TestGroup, TestInventoryGroup>>;
  readonly files: readonly TestInventoryFile[];
}

async function discoverTestFiles(directory: string): Promise<readonly string[]> {
  const discovered: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) discovered.push(...(await discoverTestFiles(path)));
    else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) discovered.push(path);
  }
  return discovered;
}

export function groupForFile(path: string): TestGroup | undefined {
  if (path.startsWith('tests/benchmarks/')) return 'benchmarks';
  if (path.startsWith('tests/browser-bench/')) return 'browser-bench';
  if (path.startsWith('tests/e2e/')) return 'e2e';
  if (path.startsWith('tests/integration/')) return 'integration';
  if (path.startsWith('tests/real-payload/')) return 'real-payload';
  if (path.startsWith('tests/soak/')) return 'soak';
  if (path.startsWith('tests/unit/')) return 'unit';
  return undefined;
}

function emptyGroup(): TestInventoryGroup {
  return { files: 0, suites: 0, tests: 0, benchmarks: 0 };
}

function addFileToGroup(
  group: TestInventoryGroup,
  file: Pick<TestInventoryFile, 'benchmarks' | 'suites' | 'tests'>,
): TestInventoryGroup {
  return {
    files: group.files + 1,
    suites: group.suites + file.suites,
    tests: group.tests + file.tests,
    benchmarks: group.benchmarks + file.benchmarks,
  };
}

export async function buildTestInventory(repositoryRoot: string): Promise<{
  readonly inventory: TestInventory;
  readonly violations: readonly TestPolicyViolation[];
}> {
  const absoluteFiles = await discoverTestFiles(resolve(repositoryRoot, 'tests'));
  await Promise.all(RUNNER_CONFIGS.map((path) => readFile(resolve(repositoryRoot, path), 'utf8')));
  const files: TestInventoryFile[] = [];
  const violations: TestPolicyViolation[] = [];

  for (const absoluteFile of absoluteFiles) {
    const path = relative(repositoryRoot, absoluteFile).replaceAll('\\', '/');
    const analysis = analyzeTestSource(path, await readFile(absoluteFile, 'utf8'));
    const group = groupForFile(path);
    if (group === undefined) {
      throw new Error(`${path} is not owned by a configured test runner`);
    }
    const entry: TestInventoryFile = {
      path,
      group,
      suites: analysis.declarations.filter(({ kind }) => kind === 'suite').length,
      tests: analysis.declarations.filter(({ kind }) => kind === 'test').length,
      benchmarks: analysis.declarations.filter(({ kind }) => kind === 'benchmark').length,
    };
    files.push(entry);
    violations.push(...analysis.violations);
  }

  const groups: Record<TestGroup, TestInventoryGroup> = {
    benchmarks: emptyGroup(),
    'browser-bench': emptyGroup(),
    e2e: emptyGroup(),
    integration: emptyGroup(),
    'real-payload': emptyGroup(),
    soak: emptyGroup(),
    unit: emptyGroup(),
  };
  let totals = emptyGroup();
  for (const file of files) {
    groups[file.group] = addFileToGroup(groups[file.group], file);
    totals = addFileToGroup(totals, file);
  }

  return {
    inventory: {
      schemaVersion: 1,
      policy: { focused: 0, skipped: 0, todo: 0, expectedFailure: 0 },
      runnerConfigs: RUNNER_CONFIGS,
      totals,
      groups,
      files,
    },
    violations,
  };
}

export function serializeTestInventory(inventory: TestInventory): string {
  return `${JSON.stringify(inventory, undefined, 2)}\n`;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const inventoryPath = resolve(repositoryRoot, 'quality/test-inventory.json');
  const shouldWrite = process.argv.includes('--write');
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--write');
  if (unknownArguments.length > 0) {
    throw new Error(`unknown arguments: ${unknownArguments.join(', ')}`);
  }

  const { inventory, violations } = await buildTestInventory(repositoryRoot);
  if (violations.length > 0) {
    throw new Error(
      `test policy failed:\n${violations.map(({ message }) => `- ${message}`).join('\n')}`,
    );
  }

  const serialized = serializeTestInventory(inventory);
  if (shouldWrite) {
    await writeFile(inventoryPath, serialized);
    console.log(
      `Wrote ${relative(repositoryRoot, inventoryPath)} (${String(inventory.totals.files)} files).`,
    );
    return;
  }

  const committed = await readFile(inventoryPath, 'utf8');
  if (committed !== serialized) {
    throw new Error('test inventory is stale; run: tsx scripts/test-policy.ts --write');
  }
  console.log(
    `Test policy passed: ${String(inventory.totals.files)} files, ${String(inventory.totals.tests)} test declarations, zero skips/focus/todos/expected failures.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
