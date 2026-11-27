import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateInlineScript } from '../src/inline/generator';
import { INLINE_BUDGET, INLINE_FRAGMENT_BUDGET, INLINE_ROUTE_BUDGET } from './bundle-budgets';
import {
  findBudgetViolations,
  measureBundle,
  type BundleBudget,
  type BundleMeasurement,
} from './bundle-measure';
import { ALL_JAVASCRIPT_BUDGET, ENTRY_BUDGETS } from './entry-budgets';
import { closureBytes, entryClosure, reexportsOnly } from './entry-closure';
import { improvementNotice } from './size-budget-notice';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PACKAGE_JSON = resolve(ROOT, 'package.json');

const STABLE_EXPORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  'index.js': [
    'EventEmitter',
    'LivePreviewClient',
    'OriginDetector',
    'generateInlineScript',
    'initLivePreview',
  ],
};

/** Core is selectively name-minified, so every callable export is contractual. */
const ALL_CALLABLE_EXPORT_NAMES = new Set(['core.js']);

/** A module two entries share, as the build names it. No budget row names one: it is measured with each entry that loads it. */
const CHUNK = /^chunk-[A-Z0-9]+\.js$/u;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function collectManifestTargets(value: unknown, label: string, targets: Map<string, string>): void {
  if (typeof value === 'string') {
    targets.set(label, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectManifestTargets(entry, `${label}[${String(index)}]`, targets);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    collectManifestTargets(child, `${label}.${key}`, targets);
  }
}

/**
 * The one target that legitimately sits outside `dist/`: the manifest exporting
 * itself. `require('payload-live-preview/package.json')` is how tooling reads
 * the installed version, and without the export Node answers
 * ERR_PACKAGE_PATH_NOT_EXPORTED — measured on a real consumer whose E2E gate
 * asserts the running runtime's version. Named here rather than admitted by a
 * looser rule, so nothing else drifts out of dist with it.
 */
const SELF_MANIFEST_TARGET = './package.json';

function resolveManifestTarget(target: string): string | undefined {
  if (target === SELF_MANIFEST_TARGET) return resolve(ROOT, 'package.json');
  if (!target.startsWith('./dist/')) return undefined;
  const absolute = resolve(ROOT, target.slice(2));
  const relativeTarget = relative(DIST, absolute);
  if (
    relativeTarget.length === 0 ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${sep}`)
  ) {
    return undefined;
  }
  return absolute;
}

function validateExportCondition(
  exportName: string,
  condition: 'import' | 'default',
  branch: unknown,
): readonly string[] {
  const failures: string[] = [];
  if (!isRecord(branch)) {
    return [`exports.${exportName}.${condition} must declare both types and default targets`];
  }
  const conditionKeys = Object.keys(branch);
  if (conditionKeys.indexOf('types') > conditionKeys.indexOf('default')) {
    failures.push(`exports.${exportName}.${condition} must list types before default`);
  }
  const defaultTarget = branch['default'];
  const typesTarget = branch['types'];
  if (typeof defaultTarget !== 'string') {
    failures.push(`exports.${exportName}.${condition}.default is not a string target`);
  } else {
    if (!defaultTarget.endsWith('.js')) {
      failures.push(`exports.${exportName}.${condition}.default must end in .js: ${defaultTarget}`);
    }
  }
  if (typeof typesTarget !== 'string') {
    failures.push(`exports.${exportName}.${condition}.types is not a string target`);
  } else {
    if (!typesTarget.endsWith('.d.ts')) {
      failures.push(`exports.${exportName}.${condition}.types must end in .d.ts: ${typesTarget}`);
    }
  }
  return failures;
}

function validateExportConditions(exportsValue: unknown): readonly string[] {
  if (!isRecord(exportsValue)) return ['package.json exports must be an object'];
  const failures: string[] = [];
  for (const [exportName, descriptor] of Object.entries(exportsValue)) {
    if (!isRecord(descriptor)) continue;
    // ESM alone since 3.0: `require()` reaches an entry through `default`, never a build of its own.
    if ('require' in descriptor) {
      failures.push(`exports.${exportName} names a CommonJS build, which 3.0 does not have`);
    }
    for (const condition of ['import', 'default'] as const) {
      if (condition in descriptor) {
        failures.push(...validateExportCondition(exportName, condition, descriptor[condition]));
      }
    }
  }
  return failures;
}

async function validateSourceMap(entry: string): Promise<readonly string[]> {
  const failures: string[] = [];
  const entryPath = resolve(DIST, entry);
  const mapName = `${entry}.map`;
  const mapPath = resolve(DIST, mapName);
  if (!(await exists(mapPath))) return [`${entry} has no adjacent source map ${mapName}`];

  const code = await readFile(entryPath, 'utf8');
  if (!code.includes(`sourceMappingURL=${basename(mapName)}`)) {
    failures.push(`${entry} does not reference its adjacent source map ${basename(mapName)}`);
  }

  try {
    const sourceMap: unknown = JSON.parse(await readFile(mapPath, 'utf8'));
    if (!isRecord(sourceMap)) return [`${mapName} is not a JSON object`];
    if (sourceMap['version'] !== 3) failures.push(`${mapName} does not use source-map version 3`);
    if (sourceMap['file'] !== basename(entry)) {
      failures.push(
        `${mapName} points at ${String(sourceMap['file'])}, expected ${basename(entry)}`,
      );
    }
    const sources = sourceMap['sources'];
    // An entry that only re-exports from chunks has no line of its own to map.
    const empty = sourceMap['mappings'] === '' && reexportsOnly(code);
    if (Array.isArray(sources) && sources.length === 0 && empty) {
      // Nothing to check: the map is empty because the file is.
    } else if (!Array.isArray(sources) || sources.length === 0) {
      failures.push(`${mapName} has no source list`);
    } else {
      for (const source of sources) {
        if (typeof source !== 'string') {
          failures.push(`${mapName} contains a non-string source path`);
        } else if (
          isAbsolute(source) ||
          /^[A-Za-z]:[\\/]/.test(source) ||
          source.startsWith('file:')
        ) {
          failures.push(`${mapName} leaks an absolute source path: ${source}`);
        }
      }
    }
    if (typeof sourceMap['mappings'] !== 'string') failures.push(`${mapName} has no mappings`);
  } catch (error: unknown) {
    failures.push(`${mapName} is not valid JSON: ${String(error)}`);
  }
  return failures;
}

async function listJavaScriptFiles(directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listJavaScriptFiles(path)));
    } else if (entry.name.endsWith('.js')) {
      files.push(relative(DIST, path).split(sep).join('/'));
    }
  }
  return files.sort();
}

function printMeasurement(
  name: string,
  measurement: BundleMeasurement,
  budget: BundleBudget,
): number {
  const violations = findBudgetViolations(measurement, budget);
  const status = violations.length === 0 ? 'PASS' : 'FAIL';
  console.log(
    `${status} ${name}: ${String(measurement.raw)} raw / ${String(measurement.gzip)} gzip / ${String(measurement.brotli)} brotli`,
  );
  for (const violation of violations) {
    console.error(
      `  ${violation.metric}: ${String(violation.actual)} > ${String(violation.limit)} byte budget`,
    );
  }
  for (const metric of ['raw', 'gzip', 'brotli'] as const) {
    const notice = improvementNotice(name, measurement[metric], budget[metric], metric);
    if (notice !== undefined) console.log(notice);
  }
  return violations.length;
}

async function main(): Promise<void> {
  let failures = printMeasurement(
    'default inline script',
    measureBundle(generateInlineScript()),
    INLINE_BUDGET,
  );
  failures += printMeasurement(
    'inline script with the route strategy',
    measureBundle(generateInlineScript({ routeStrategy: true })),
    INLINE_ROUTE_BUDGET,
  );
  failures += printMeasurement(
    'inline script with fragments',
    measureBundle(generateInlineScript({ fragmentEndpoint: '/payload/fragment' })),
    INLINE_FRAGMENT_BUDGET,
  );
  const manifestValue: unknown = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
  if (!isRecord(manifestValue)) throw new Error('package.json is not an object');

  for (const [field, extension] of [
    ['main', '.js'],
    ['types', '.d.ts'],
  ] as const) {
    const value = manifestValue[field];
    if (typeof value !== 'string' || !value.endsWith(extension)) {
      console.error(`FAIL package.json ${field} must be a ${extension} target`);
      failures += 1;
    }
  }
  const binValue = manifestValue['bin'];
  if (!isRecord(binValue) || typeof binValue['pll-codegen'] !== 'string') {
    console.error('FAIL package.json must declare the pll-codegen binary target');
    failures += 1;
  }

  const manifestTargets = new Map<string, string>();
  for (const field of ['main', 'types'] as const) {
    collectManifestTargets(manifestValue[field], field, manifestTargets);
  }
  collectManifestTargets(manifestValue['exports'], 'exports', manifestTargets);
  collectManifestTargets(manifestValue['bin'], 'bin', manifestTargets);

  for (const error of validateExportConditions(manifestValue['exports'])) {
    console.error(`FAIL ${error}`);
    failures += 1;
  }
  for (const [label, target] of manifestTargets) {
    const absolute = resolveManifestTarget(target);
    if (absolute === undefined) {
      console.error(`FAIL ${label} is not a safe dist-relative target: ${target}`);
      failures += 1;
    } else if (!(await exists(absolute))) {
      console.error(`FAIL ${label} target is absent from dist: ${target}`);
      failures += 1;
    }
  }

  const actualFiles = await listJavaScriptFiles(DIST);
  const actualEntries = actualFiles.filter((file) => !CHUNK.test(file));
  const expectedEntries = Object.keys(ENTRY_BUDGETS).sort();
  const unexpected = actualEntries.filter((entry) => !(entry in ENTRY_BUDGETS));
  const missing = expectedEntries.filter((entry) => !actualEntries.includes(entry));

  for (const entry of unexpected) console.error(`FAIL unexpected JavaScript artifact: ${entry}`);
  for (const entry of missing) console.error(`FAIL missing JavaScript artifact: ${entry}`);
  failures += unexpected.length + missing.length;

  // An entry's row is its closure: its own file and the chunks it loads.
  const reached = new Set<string>();
  for (const entry of expectedEntries) {
    if (missing.includes(entry)) continue;
    const file = resolve(DIST, entry);
    for (const part of await entryClosure(file)) {
      reached.add(relative(DIST, part).split(sep).join('/'));
    }
    failures += printMeasurement(
      entry,
      measureBundle(await closureBytes(file)),
      ENTRY_BUDGETS[entry]!,
    );
  }
  for (const file of actualFiles) {
    if (reached.has(file)) continue;
    console.error(`FAIL ${file} is loaded by no entry`);
    failures += 1;
  }
  // What the archive carries: every file once, which the closures count several times. Each
  // file is measured by itself and the sizes are added, so the order of the files, which
  // follows the hashes in the chunks' names, decides nothing.
  const whole = { raw: 0, gzip: 0, brotli: 0 };
  for (const file of actualFiles) {
    const size = measureBundle(await readFile(resolve(DIST, file)));
    whole.raw += size.raw;
    whole.gzip += size.gzip;
    whole.brotli += size.brotli;
  }
  failures += printMeasurement('all JavaScript', whole, ALL_JAVASCRIPT_BUDGET);

  for (const entry of actualFiles) {
    for (const error of await validateSourceMap(entry)) {
      console.error(`FAIL ${error}`);
      failures += 1;
    }
  }

  for (const [entry, exportNames] of Object.entries(STABLE_EXPORT_NAMES)) {
    const namespace: unknown = await import(pathToFileURL(resolve(DIST, entry)).href);
    if (typeof namespace !== 'object' || namespace === null) {
      console.error(`FAIL ${entry}: module namespace is not an object`);
      failures += 1;
      continue;
    }
    for (const exportName of exportNames) {
      const exported: unknown = Reflect.get(namespace, exportName);
      if (typeof exported !== 'function' || exported.name !== exportName) {
        console.error(
          `FAIL ${entry}: ${exportName} has observable name ${typeof exported === 'function' ? JSON.stringify(exported.name) : '<non-function>'}`,
        );
        failures += 1;
      }
    }
  }

  for (const entry of ALL_CALLABLE_EXPORT_NAMES) {
    const namespace: unknown = await import(pathToFileURL(resolve(DIST, entry)).href);
    if (typeof namespace !== 'object' || namespace === null) {
      console.error(`FAIL ${entry}: module namespace is not an object`);
      failures += 1;
      continue;
    }
    for (const [exportName, exported] of Object.entries(namespace as Record<string, unknown>)) {
      if (typeof exported === 'function' && exported.name !== exportName) {
        console.error(
          `FAIL ${entry}: ${exportName} has observable name ${JSON.stringify(exported.name)}`,
        );
        failures += 1;
      }
    }
  }

  if (failures > 0) {
    throw new Error(`bundle-size gate failed with ${String(failures)} violation(s)`);
  }
}

await main();
