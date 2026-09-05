import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateInlineScript } from '../src/inline/generator';
import {
  findBudgetViolations,
  INLINE_BUDGET,
  INLINE_FRAGMENT_BUDGET,
  measureBundle,
  type BundleBudget,
  type BundleMeasurement,
} from './bundle-budgets';
import { improvementNotice } from './size-budget-notice';

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
  // from the `types` leaf for exactly that reason. 2026-08-27 (1.3.0): the keyed
  // morph (ADR 0008), its diagnostics and the template sanitizer options add
  // ~1.4 KB gzip to the inline runtime and therefore to every adapter bundle. core.* rows: +~200 B gzip for
  // the message bus source policy (eventSourcePolicy), same date. 2026-09-04:
  // +~45 B gzip in every adapter that embeds the runtime, for the reveal ledger
  // fix recorded in bundle-budgets.ts. 2026-09-05: +~70 B gzip in every bundle
  // that embeds the runtime, for the per-instance sanitizer policy (see
  // bundle-budgets.ts); astro +~285 B for `authorizePreview` on the fragment
  // endpoint and `LivePreviewLocals`, the other adapters +~70–120 B for the
  // type-bound locals writes and the shared CSP helper; migrate.js and
  // doctor-cli.js +~170/+~75 B for the `rename-admin-origins-option` codemod;
  // server.* +~50 B for the entry split into a barrel and `preview.ts`;
  // index.js brotli lowered to the measured 45 859.
  'adapters/astro/index.js': { raw: 130_750, gzip: 41_500, brotli: 36_250 },
  'adapters/astro/middleware-entry.js': { raw: 117_250, gzip: 37_300, brotli: 32_550 },
  'adapters/nextjs/index.js': { raw: 117_000, gzip: 37_250, brotli: 32_500 },
  'adapters/nuxt/index.js': { raw: 117_650, gzip: 37_450, brotli: 32_650 },
  'adapters/sveltekit/index.js': { raw: 116_750, gzip: 37_200, brotli: 32_450 },
  'codegen-astro.js': { raw: 12_950, gzip: 4_550, brotli: 4_100 },
  'codegen-cli.js': { raw: 14_550, gzip: 5_000, brotli: 4_500 },
  'codegen.cjs': { raw: 12_450, gzip: 4_250, brotli: 3_860 },
  'codegen.js': { raw: 12_300, gzip: 4_250, brotli: 3_850 },
  'doctor-cli.js': { raw: 32_750, gzip: 12_000, brotli: 10_650 },
  'doctor.js': { raw: 13_100, gzip: 5_500, brotli: 4_750 },
  'migrate.js': { raw: 13_350, gzip: 4_800, brotli: 4_250 },
  'core.cjs': { raw: 111_700, gzip: 34_950, brotli: 30_500 },
  'core.js': { raw: 111_200, gzip: 34_900, brotli: 30_400 },
  'index.cjs': { raw: 232_050, gzip: 71_800, brotli: 46_850 },
  'index.js': { raw: 231_450, gzip: 71_950, brotli: 45_900 },
  // The two smallest entries are budgeted to 5 bytes rather than 50: at ~1 KB a
  // 50-byte step is 5 % of the artifact, which stops being a budget.
  'payload.cjs': { raw: 1_090, gzip: 575, brotli: 515 },
  'payload.js': { raw: 1_080, gzip: 575, brotli: 515 },
  // Measured 2026-08-27 (12465/4730/4307 and 12292/4670/4212), ~1 % headroom.
  'server.cjs': { raw: 12_000, gzip: 4_450, brotli: 4_000 },
  'server.js': { raw: 11_850, gzip: 4_400, brotli: 4_000 },
  'client.cjs': { raw: 106_600, gzip: 33_200, brotli: 28_950 },
  'client.js': { raw: 106_550, gzip: 33_150, brotli: 28_950 },
  'structural.cjs': { raw: 18_600, gzip: 6_500, brotli: 5_900 },
  'structural.js': { raw: 18_600, gzip: 6_500, brotli: 5_900 },
  'lexical.cjs': { raw: 15_700, gzip: 5_350, brotli: 4_800 },
  'lexical.js': { raw: 15_700, gzip: 5_350, brotli: 4_800 },
  'plugins.cjs': { raw: 15_550, gzip: 5_650, brotli: 5_000 },
  'plugins.js': { raw: 15_550, gzip: 5_650, brotli: 5_000 },
  'fragment.cjs': { raw: 13_950, gzip: 5_350, brotli: 4_700 },
  'fragment.js': { raw: 13_850, gzip: 5_300, brotli: 4_700 },
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
    'inline script with fragments',
    measureBundle(generateInlineScript({ fragmentEndpoint: '/payload/fragment' })),
    INLINE_FRAGMENT_BUDGET,
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
