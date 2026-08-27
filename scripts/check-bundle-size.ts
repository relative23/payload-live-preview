import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateInlineScript } from '../src/inline/generator';
import {
  findBudgetViolations,
  INLINE_BUDGET,
  measureBundle,
  type BundleBudget,
  type BundleMeasurement,
} from './bundle-budgets';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PACKAGE_JSON = resolve(ROOT, 'package.json');

// Budgets include narrow headroom for patch-level correctness fixes while still
// failing the unminified 1.0.4 artifacts. Public names and source maps are retained.
const ENTRY_BUDGETS: Readonly<Record<string, BundleBudget>> = {
  // Adapter rows raised twice on 2026-08-27, measured with ~1 % headroom:
  // +~200 B gzip when the four adapters moved onto the shared preview policy
  // (one decision path per bundle costs more than straight-line code the
  // minifier could fold), then +~1.2 KB gzip for the authorization gate —
  // authorizePreview, strict-mode checks, the defaults profile, the development
  // warnings, and the runtime's source policy embedded in every adapter bundle.
  // The HMAC/session code is not in these bundles; the brand check is imported
  // from the `types` leaf for exactly that reason. core.* rows: +~200 B gzip for
  // the message bus source policy (eventSourcePolicy), same date.
  'adapters/astro/index.js': { raw: 85_000, gzip: 26_800, brotli: 23_700 },
  'adapters/astro/middleware-entry.js': { raw: 80_500, gzip: 25_400, brotli: 22_400 },
  'adapters/nextjs/index.js': { raw: 80_500, gzip: 25_300, brotli: 22_350 },
  'adapters/nuxt/index.js': { raw: 80_500, gzip: 25_400, brotli: 22_400 },
  'adapters/sveltekit/index.js': { raw: 80_200, gzip: 25_300, brotli: 22_300 },
  'codegen-astro.js': { raw: 13_000, gzip: 4_300, brotli: 3_900 },
  'codegen-cli.js': { raw: 15_000, gzip: 4_800, brotli: 4_300 },
  'codegen.cjs': { raw: 13_000, gzip: 4_100, brotli: 3_700 },
  'codegen.js': { raw: 13_000, gzip: 4_100, brotli: 3_700 },
  'doctor-cli.js': { raw: 10_500, gzip: 4_400, brotli: 3_800 },
  'doctor.js': { raw: 8_700, gzip: 3_700, brotli: 3_150 },
  'core.cjs': { raw: 81_100, gzip: 25_300, brotli: 22_350 },
  'core.js': { raw: 80_750, gzip: 25_200, brotli: 22_300 },
  'index.cjs': { raw: 172_800, gzip: 53_850, brotli: 38_100 },
  'index.js': { raw: 172_250, gzip: 53_550, brotli: 37_950 },
  'payload.cjs': { raw: 1_100, gzip: 600, brotli: 500 },
  'payload.js': { raw: 1_100, gzip: 600, brotli: 500 },
  // Measured 2026-08-27 (12465/4730/4307 and 12292/4670/4212), ~1 % headroom.
  'server.cjs': { raw: 12_600, gzip: 4_800, brotli: 4_350 },
  'server.js': { raw: 12_450, gzip: 4_720, brotli: 4_260 },
};

const STABLE_EXPORT_NAMES: Readonly<Record<string, readonly string[]>> = {
  'index.cjs': [
    'EventEmitter',
    'LivePreviewClient',
    'OriginDetector',
    'generateInlineScript',
    'initLivePreview',
  ],
  'index.js': [
    'EventEmitter',
    'LivePreviewClient',
    'OriginDetector',
    'generateInlineScript',
    'initLivePreview',
  ],
};

/** Core is selectively name-minified, so every callable export is contractual. */
const ALL_CALLABLE_EXPORT_NAMES = new Set(['core.cjs', 'core.js']);

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

function resolveManifestTarget(target: string): string | undefined {
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
  condition: 'import' | 'require',
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
    const extension = condition === 'import' ? '.js' : '.cjs';
    if (!defaultTarget.endsWith(extension)) {
      failures.push(
        `exports.${exportName}.${condition}.default must end in ${extension}: ${defaultTarget}`,
      );
    }
  }
  if (typeof typesTarget !== 'string') {
    failures.push(`exports.${exportName}.${condition}.types is not a string target`);
  } else {
    const extension = condition === 'import' ? '.d.ts' : '.d.cts';
    if (!typesTarget.endsWith(extension)) {
      failures.push(
        `exports.${exportName}.${condition}.types must end in ${extension}: ${typesTarget}`,
      );
    }
  }
  return failures;
}

function validateExportConditions(exportsValue: unknown): readonly string[] {
  if (!isRecord(exportsValue)) return ['package.json exports must be an object'];
  const failures: string[] = [];
  for (const [exportName, descriptor] of Object.entries(exportsValue)) {
    if (!isRecord(descriptor)) continue;
    for (const condition of ['import', 'require'] as const) {
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
    if (!Array.isArray(sources) || sources.length === 0) {
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
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.cjs')) {
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
  return violations.length;
}

async function main(): Promise<void> {
  let failures = printMeasurement(
    'default inline script',
    measureBundle(generateInlineScript()),
    INLINE_BUDGET,
  );
  const manifestValue: unknown = JSON.parse(await readFile(PACKAGE_JSON, 'utf8'));
  if (!isRecord(manifestValue)) throw new Error('package.json is not an object');

  for (const [field, extension] of [
    ['main', '.cjs'],
    ['module', '.js'],
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
  for (const field of ['main', 'module', 'types'] as const) {
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

  const actualEntries = await listJavaScriptFiles(DIST);
  const expectedEntries = Object.keys(ENTRY_BUDGETS).sort();
  const unexpected = actualEntries.filter((entry) => !(entry in ENTRY_BUDGETS));
  const missing = expectedEntries.filter((entry) => !actualEntries.includes(entry));

  for (const entry of unexpected) console.error(`FAIL unexpected JavaScript artifact: ${entry}`);
  for (const entry of missing) console.error(`FAIL missing JavaScript artifact: ${entry}`);
  failures += unexpected.length + missing.length;

  for (const entry of expectedEntries) {
    if (missing.includes(entry)) continue;
    const bytes = await readFile(resolve(DIST, entry));
    failures += printMeasurement(entry, measureBundle(bytes), ENTRY_BUDGETS[entry]!);
  }

  for (const entry of actualEntries) {
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
