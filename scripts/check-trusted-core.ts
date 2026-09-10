/**
 * The trusted core, measured: how many lines a reader has to read before they
 * can trust this package with a page, and whether that number moved.
 *
 * The capability rules in `architecture-rules.ts` decide *which* modules the
 * core is — every module that holds a capability is either in it or reviewed
 * as staying outside. This gate holds the core's *size*: its line count
 * against the reviewed ceiling, and its runtime imports from outside itself
 * against the reviewed list, so the core can neither grow nor quietly pull
 * more code into the reader's afternoon. Both numbers live in
 * `quality/trusted-core.json` beside the reason they are what they are.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchitectureModules, type ArchitectureModule } from './architecture-graph';
import { improvementNotice } from './size-budget-notice';
import {
  readTrustedCorePolicy,
  TRUSTED_CORE_POLICY_FILE,
  type TrustedCorePolicy,
} from './trusted-core-policy';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');

export interface TrustedCoreMeasurement {
  readonly modules: readonly string[];
  /** Per module and in total, counted the way `wc -l` counts. */
  readonly lines: Readonly<Record<string, number>>;
  readonly totalLines: number;
  /** Exported declarations per module: the names other modules can reach. */
  readonly declarations: Readonly<Record<string, number>>;
  readonly totalDeclarations: number;
  /** Runtime imports of the core that resolve outside it, sorted and unique. */
  readonly dependencies: readonly string[];
}

/** Newlines, as `wc -l` reports them; a final line without one is still a line. */
export function countLines(source: string): number {
  if (source.length === 0) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

export function countExportedDeclarations(source: string): number {
  return [...source.matchAll(/^export /gmu)].length;
}

export async function measureTrustedCore(
  repositoryRoot: string,
  policy: TrustedCorePolicy,
  modules: readonly ArchitectureModule[],
): Promise<TrustedCoreMeasurement> {
  const core = Object.keys(policy.core.modules).sort();
  const coreSet = new Set(core);
  const lines: Record<string, number> = {};
  const declarations: Record<string, number> = {};
  const dependencies = new Set<string>();
  for (const path of core) {
    const source = await readFile(resolve(repositoryRoot, path), 'utf8');
    lines[path] = countLines(source);
    declarations[path] = countExportedDeclarations(source);
    const module = modules.find((candidate) => candidate.path === path);
    for (const dependency of module?.dependencies ?? []) {
      if (dependency.kind !== 'runtime' || dependency.target === undefined) continue;
      if (!coreSet.has(dependency.target)) dependencies.add(dependency.target);
    }
  }
  return {
    modules: core,
    lines,
    totalLines: Object.values(lines).reduce((sum, count) => sum + count, 0),
    declarations,
    totalDeclarations: Object.values(declarations).reduce((sum, count) => sum + count, 0),
    dependencies: [...dependencies].sort(),
  };
}

export function findTrustedCoreViolations(
  measurement: TrustedCoreMeasurement,
  policy: TrustedCorePolicy,
): readonly string[] {
  const violations: string[] = [];
  if (measurement.totalLines > policy.core.lines.limit) {
    violations.push(
      `the trusted core is ${String(measurement.totalLines)} lines, above the reviewed ${String(policy.core.lines.limit)}`,
    );
  }
  const reviewed = new Set(Object.keys(policy.core.dependencies));
  for (const dependency of measurement.dependencies) {
    if (!reviewed.has(dependency)) {
      violations.push(
        `the trusted core imports ${dependency}, which ${TRUSTED_CORE_POLICY_FILE} does not review`,
      );
    }
  }
  for (const dependency of reviewed) {
    if (!measurement.dependencies.includes(dependency)) {
      violations.push(
        `${TRUSTED_CORE_POLICY_FILE} reviews ${dependency}, which the trusted core no longer imports`,
      );
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const policy = await readTrustedCorePolicy(ROOT);
  const modules = await readArchitectureModules(ROOT);
  const measurement = await measureTrustedCore(ROOT, policy, modules);
  const violations = findTrustedCoreViolations(measurement, policy);

  const notice = improvementNotice(
    'trusted core',
    measurement.totalLines,
    policy.core.lines.limit,
    'lines',
  );
  if (notice !== undefined) console.log(notice);
  if (violations.length > 0) {
    for (const violation of violations) console.error(`FAIL ${violation}`);
    console.error(
      `trusted core: a line added here is a line every reader has to trust; raise the number in ${TRUSTED_CORE_POLICY_FILE} and write down why.`,
    );
    throw new Error(`trusted core failed with ${String(violations.length)} violation(s)`);
  }
  console.log(
    `Trusted core passed: ${String(measurement.modules.length)} modules, ` +
      `${String(measurement.totalLines)} lines (limit ${String(policy.core.lines.limit)}), ` +
      `${String(measurement.totalDeclarations)} exported declarations, ` +
      `${String(measurement.dependencies.length)} reviewed imports from outside.`,
  );
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
