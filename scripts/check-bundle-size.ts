import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LEAN_RUNTIME } from '../src/lean';
import { generateInlineScript } from '../src/inline/generator';
import {
  findBudgetViolations,
  INLINE_BUDGET,
  INLINE_LEAN_BUDGET,
  INLINE_FRAGMENT_BUDGET,
  INLINE_ROUTE_BUDGET,
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
  // index.js brotli lowered towards its measurement. Brotli is not byte-stable:
  // CI compressed index.js 45 915 and then 45 959 B from byte-identical raw
  // and gzip output, 56–100 B over this host. Every brotli row therefore keeps
  // about 120 B over the local figure, still under the 2 % the improvement
  // hint allows; raw and gzip rows stay tight because they reproduce.
  //
  // 2026-09-06: every row that embeds the inline runtime rises by the ~660 B
  // gzip `onUnboundChange` costs it (see bundle-budgets.ts) — the adapters, the
  // client, core and the root barrel. The Next row additionally carries
  // `livePreviewScriptProps()`, a few dozen bytes. `doctor-cli.js` moves for the
  // runtime source it embeds for its readiness probe, nothing of its own.
  //
  // 2026-09-06 (fragment endpoint for Next.js): the Next row rises ~10 KB raw /
  // ~3.1 KB gzip because that entry now carries the fragment endpoint —
  // authorization, the protocol parser, limits, the registry lookup. It is the
  // same code the Astro entry already carried; a project that never imports
  // `createFragmentEndpoint` does not ship it — the `createLivePreviewMiddleware`
  // fixture in check-tree-shaking.ts measures ~2.4 KB gzip less than this row. The Astro row rises ~200 B raw for the module boundary the
  // move introduces (the endpoint no longer inlines into its one caller).
  //
  // 2026-09-06 (fragment endpoint for SvelteKit and Nuxt, `preview.boundary()`):
  // those two adapter rows rise ~10 KB raw / ~3 KB gzip for the endpoint they
  // now carry, exactly as the Next row did — a project that never imports
  // `createFragmentEndpoint` still ships none of it. `core.*`, `index.*` and
  // `server.*` rise ~650 B raw / ~270 B gzip for `createPreviewBindings().boundary()`:
  // the registry-id and key checks, and the attribute record it builds.
  //
  // 2026-09-06 (Ü9, the lean runtime): `lean.*` are new rows — the second
  // artifact as a value, which is almost entirely the embedded script. It sits
  // behind its own subpath so only a project that imports it carries those
  // bytes; behind a `profile: 'lean'` option instead, the same artifact landed
  // in every adapter entry and measured +24 KB gzip each. Every row that embeds
  // the runtime rises ~90 B raw for the profile's own code: the LP0104 message,
  // the renderers that report it, and the two strategy warnings the lean build
  // keeps as shared functions.
  //
  // 2026-09-06 (Ü11): every row that embeds the runtime carries the LP0503
  // message with it (see bundle-budgets.ts); `fragment.js` moves for the
  // strategy warnings it now shares with the runtime.
  //
  // 2026-09-06 (R5, `delivery: 'asset'`): every adapter entry rises ~500 B gzip.
  // The bootstrap source and the asset descriptor now sit in the shared script
  // path, so all four adapters can serve the runtime as a cached file instead
  // of embedding it — Astro's own loader mode reads the same descriptor rather
  // than a second copy. These are server bundles; the bytes this buys back are
  // the ~38 KB gzip a preview page no longer carries on its second load. The
  // `lean.*` rows rise ~100 B gzip for the artifact's own two digests, without
  // which it could be embedded but never served.
  //
  // 2026-09-06 (R6): the SvelteKit and Nuxt rows rise ~270 B gzip for their own
  // asset routes — the shared response builder was already in the bundle, so
  // this is the route shape each framework wants and nothing more.
  //
  // 2026-09-06 (R8, the build-time annotator): `annotate.js` is a new row and a
  // small one — the plugin is the scanner plus a rewrite, and the scanner is
  // regular expressions. It carries no ts-morph, which is the reason it is an
  // entry of its own rather than part of `./codegen`.
  'annotate.js': { raw: 2_950, gzip: 1_544, brotli: 1_380 },
  'adapters/astro/index.js': { raw: 143_150, gzip: 44_450, brotli: 38_480 },
  'adapters/astro/middleware-entry.js': { raw: 129_850, gzip: 40_360, brotli: 34_900 },
  'adapters/nextjs/index.js': { raw: 141_400, gzip: 43_950, brotli: 38_030 },
  //
  // 2026-09-06 (`./react`, `./vue`): two new rows, measured at 14 045 / 13 814
  // raw and 4 637 / 4 621 gzip. Both entries carry the message bus, the origin
  // detector and the merger — the document half of the runtime — and nothing
  // that touches an element, which is why each is a third of an adapter row.
  // They share every module but their reactivity, hence the near-identical
  // figures.
  'adapters/react/index.js': { raw: 14_250, gzip: 4_700, brotli: 4_260 },
  'adapters/vue/index.js': { raw: 14_000, gzip: 4_690, brotli: 4_220 },
  //
  // 2026-09-06 (R4, zero-config setup): one new row. `adapters/nuxt/module.js`
  // is the build-time Nuxt module — a few hundred bytes, because all it does is
  // write a plugin into `.nuxt/` and register its path; the runtime it pulls in
  // is the existing `./nuxt` entry, which the generated plugin imports. The Next
  // row rises ~700 B gzip for `withLivePreview()`: the header rules and the
  // frame-ancestors builder it shares with the middleware.
  'adapters/nuxt/module.js': { raw: 660, gzip: 426, brotli: 349 },
  'adapters/nuxt/index.js': { raw: 140_900, gzip: 43_830, brotli: 37_930 },
  'adapters/sveltekit/index.js': { raw: 139_900, gzip: 43_560, brotli: 37_700 },
  //
  // 2026-09-06 (Ü12): the codegen rows carry the annotator — the template
  // scanner, its refusal reasons and the `annotate` subcommand. It is a build
  // tool; no page and no adapter bundle sees any of it.
  'codegen-astro.js': { raw: 12_950, gzip: 4_550, brotli: 4_100 },
  'codegen-cli.js': { raw: 20_100, gzip: 6_950, brotli: 6_270 },
  'codegen.cjs': { raw: 15_300, gzip: 5_400, brotli: 4_890 },
  'codegen.js': { raw: 15_200, gzip: 5_380, brotli: 4_890 },
  'doctor-cli.js': { raw: 33_150, gzip: 12_140, brotli: 10_780 },
  'doctor.js': { raw: 13_100, gzip: 5_500, brotli: 4_750 },
  'migrate.js': { raw: 13_350, gzip: 4_800, brotli: 4_320 },
  'core.cjs': { raw: 117_300, gzip: 36_650, brotli: 31_900 },
  'core.js': { raw: 116_800, gzip: 36_600, brotli: 31_850 },
  'index.cjs': { raw: 249_400, gzip: 76_200, brotli: 49_450 },
  'index.js': { raw: 248_800, gzip: 76_300, brotli: 49_400 },
  // The two smallest entries are budgeted to 5 bytes rather than 50: at ~1 KB a
  // 50-byte step is 5 % of the artifact, which stops being a budget.
  'payload.cjs': { raw: 1_090, gzip: 575, brotli: 515 },
  'payload.js': { raw: 1_080, gzip: 575, brotli: 515 },
  // Measured 2026-08-27 (12465/4730/4307 and 12292/4670/4212), ~1 % headroom.
  // 2026-09-06 (R8): +~110 B raw for `previewBindingsFromLocals`, the one-line
  // helper the build-time annotator writes a call to.
  'server.cjs': { raw: 12_950, gzip: 4_780, brotli: 4_310 },
  'server.js': { raw: 12_830, gzip: 4_775, brotli: 4_300 },
  'client.cjs': { raw: 111_500, gzip: 34_600, brotli: 30_200 },
  'client.js': { raw: 111_400, gzip: 34_600, brotli: 30_170 },
  'structural.cjs': { raw: 18_600, gzip: 6_500, brotli: 5_950 },
  'structural.js': { raw: 18_600, gzip: 6_500, brotli: 5_950 },
  'lean.cjs': { raw: 80_600, gzip: 25_250, brotli: 22_480 },
  'lean.js': { raw: 80_600, gzip: 25_250, brotli: 22_480 },
  'lexical.cjs': { raw: 15_700, gzip: 5_350, brotli: 4_800 },
  'lexical.js': { raw: 15_700, gzip: 5_350, brotli: 4_800 },
  //
  // 2026-09-06 (Ü10): `plugins.*` rise ~2 900 raw / ~1 150 gzip for the
  // unbound-fields overlay — the development panel that lists the fields an
  // update carried and the page cannot show. It is a plugin precisely so this
  // row moves and `INLINE_BUDGET` does not: no page carries it unless its own
  // code asks for it.
  'plugins.cjs': { raw: 18_600, gzip: 6_880, brotli: 6_050 },
  'plugins.js': { raw: 18_600, gzip: 6_880, brotli: 6_050 },
  'fragment.cjs': { raw: 13_950, gzip: 5_380, brotli: 4_740 },
  'fragment.js': { raw: 13_900, gzip: 5_360, brotli: 4_720 },
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
    'inline script, lean profile',
    measureBundle(generateInlineScript({ runtime: LEAN_RUNTIME })),
    INLINE_LEAN_BUDGET,
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
