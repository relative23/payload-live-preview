import {
  Extractor,
  ExtractorConfig,
  ExtractorLogLevel,
  type IConfigFile,
} from '@microsoft/api-extractor';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

type JsonRecord = Record<string, unknown>;

export interface TypedApiEntry {
  readonly exportName: string;
  readonly importTypesTarget: string;
  /** Whether `require()` reaches the entry too: a `default` condition on the same ES module. */
  readonly requirable: boolean;
  readonly reportName: string;
}

export interface AttwInvocation {
  readonly label: 'ESM-only';
  readonly args: readonly string[];
}

export interface ApiReportCheckOptions {
  readonly apiConfigPath: string;
  readonly entries: readonly TypedApiEntry[];
  readonly packageRootForEntry: (entry: TypedApiEntry) => string;
  readonly reportFolder: string;
  readonly reportTempFolder: string;
  readonly typescriptCompilerFolder: string;
  readonly updateReports: boolean;
}

/**
 * Reviewed 1.0.x debt visible in the API reports, never a blanket warning ignore.
 *
 * 48 → 52 for static delivery: `AstroIntegrationLike` is public and reaches
 * four more local shims through it — `ViteDevServerLike`, `DevRequest`,
 * `DevResponse` and `RollupEmitContext`. They describe the slivers of Vite and
 * Rollup the loader mode touches, exist only to keep `astro` and `vite` as
 * runtime-optional peers, and exporting them would put third-party structural
 * types on this package's surface for no consumer benefit.
 *
 * 52 → 51 with the authorized preview context (1.1.0): the `astro` entry's
 * rollup no longer carries the `PreviewSignal` warning — the alias is
 * inlined into `PreviewRequestOptions` there — and every type the new
 * authorization surface references is exported from the entry that
 * references it (root, `core`, the four adapters), so the new surface adds
 * no debt. Reviewed against the report diff, not assumed.
 *
 * 51 → 52 with the server subpath (1.2.0): `payload-live-preview/server`
 * re-exports `FieldPath` and `ValueAt`, whose recursion is bounded by the
 * internal `Prev` helper type. The root entry carries the same warning in
 * this baseline already; exporting a depth-limiter tuple type would put an
 * implementation detail on the surface for no consumer benefit.
 *
 * 50 → 46 with the hybrid strategies (1.6.0/1.7.0): the strategy, inspection
 * and event types the fragment/route surface adds (`StrategyHandlers`,
 * `FragmentStrategy`, `RouteStrategy`, `FragmentContext`, `RouteContext`,
 * `InspectionFragments`, `InspectionRoute`, `UpdateSource`,
 * `PayloadDocumentEventDetail`) are now exported from the root, core, client
 * and plugins entries rather than left forgotten, a net reduction. The two
 * that remain on `./fragment` (`DiagnosticCode`, `DIAGNOSTIC_CODES`) are an
 * API-Extractor rollup artifact: the entry re-exports them and also uses
 * `DiagnosticCode` in its own signatures, which the rollup double-counts.
 *
 * 52 → 50 with the focused entries (1.4.0): `client`, `structural`, `lexical`
 * and `plugins` re-export every type their signatures reference, so they add
 * nothing; and `PayloadFieldCondition`, which `PayloadFieldSchema` references
 * and the root and core entries had left unexported, is now exported by both.
 *
 * 46 → 59 with the 2.0 correctness pass. Thirteen are structural shims a
 * consumer never names: the Nuxt adapter's `HeadersLike`/`NodeRequestLike`/
 * `NodeResponseLike`/`NodeHeaderValue` (it now reads a web-shaped h3 event as
 * well as a Node one) and, on `./astro`, the authorization strategy types and
 * `FetchLike`/`SubtleCryptoLike` — all of which the root entry does export, so
 * they are nameable, just not twice. A fourteenth was real and was fixed rather
 * than absorbed: `./structural` exports `CachedElement` but had left
 * `UpdateSource`, the type of its `strategyKind`, unexported.
 *
 * 59 → 50 when the fragment endpoint moved to `@adapters/shared`: `./astro`
 * falls from 16 warnings to 7. Its `FragmentEndpointOptions` used to declare
 * the authorization strategies inline, which left `PayloadSessionStrategy`,
 * `SignedTokenStrategy`, `VerifierStrategy`, `FetchLike`, `SubtleCryptoLike`
 * and `PreviewTokenReplayStore` forgotten in that entry alone. The bound alias
 * now points at the shared generic, so the rollup imports those types from the
 * shared chunk under their own names instead. Nothing was hidden to achieve it:
 * the surface is the same, named once instead of copied into two entries.
 */
// 2026-10-31: +1, the session's `Listener`, a plain `() => void` that `createDocumentSession()` reaches from `/core`.
// 2026-11-03: -1, the same `Listener`: `DocumentSession` is an interface whose `subscribe` spells it `() => void`.
// 2026-11-25 (3.0): -2, `PayloadBlockSchema`, which the root and core entries reached through `PayloadFieldSchema`; both types left with Payload 2.
// 2026-11-27 (3.0, one module graph): 48 to 184, and none of the 136 is new. The eight reports of
// the adapters, the Nuxt module, the hooks and the Astro middleware entry used to print
// `import { … } from '../../<chunk>.js'` where a signature reached a declaration chunk, because
// the extractor ran inside `node_modules` and took the chunk for an external library. It reads a
// copy outside it now, prints the declarations, and with them the names those signatures reach
// without the entry exporting them: astro 35, nuxt 34, sveltekit 30, nextjs 26, the Nuxt module
// 14, the middleware entry 12, the two hooks 1 each (`PreviewDocument`). The ten other reports
// are unchanged byte for byte.
// 2026-11-27 (3.0, ADR 0007 row 44): -6, the brand key six reports listed. The mark in the type is
// a `unique symbol` nothing exports, which a report prints and does not count.
// 2026-11-27 (3.0, ADR 0007 row 15): -3, types that only signatures of the internal names reached,
// which left the entries.
// 2026-11-27 (3.0, ADR 0007 row 46): -12. The core entry's report listed 8 and is gone with the
// entry. `/client` and the root name the option types of what they export (`SanitizeOptions`,
// `LexicalRenderOptions`, `OriginDetectorOptions`, and on the root `PreviewSignal`), which the root's
// report listed as 4 of its 5; `/client`'s lists none.
export const FORGOTTEN_EXPORT_BASELINE = 163;

/**
 * Require an explicit baseline review for both API-debt regressions and improvements.
 *
 * Treating the baseline as a ceiling would let a temporary improvement silently
 * regress again up to the old value. Exact equality makes every count change a
 * reviewed, versioned ratchet update.
 */
export function findForgottenExportBaselineViolation(
  actual: number,
  baseline: number = FORGOTTEN_EXPORT_BASELINE,
): string | undefined {
  if (actual === baseline) return undefined;
  return `forgotten-export debt changed from reviewed baseline ${String(baseline)} to ${String(actual)}; review the API reports and update the baseline explicitly`;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertDeclarationTarget(target: string, exportName: string): string {
  const segments = target.slice(2).split('/');
  if (
    !target.startsWith('./') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !target.endsWith('.d.ts')
  ) {
    throw new Error(`${exportName} exposes an unsafe or non-declaration types target: ${target}`);
  }
  return target;
}

/**
 * The declarations of an entry. Since 3.0 an entry is one ES module with one
 * declaration file: a `require` condition would name a CommonJS build that does
 * not exist, and a `default` condition, which is what `require()` matches, has
 * to hand out the declarations `import` gets.
 */
function typesTarget(value: JsonRecord, exportName: string): string | undefined {
  if ('require' in value) {
    throw new Error(`${exportName} names a CommonJS build; the package is ESM alone since 3.0`);
  }
  const branch = value['import'];
  const target =
    isRecord(branch) && typeof branch['types'] === 'string' ? branch['types'] : value['types'];
  if (typeof target !== 'string') return undefined;
  const fallback = value['default'];
  if (isRecord(fallback) && fallback['types'] !== target) {
    throw new Error(
      `${exportName} gives require() other declarations than import: ${String(fallback['types'])} != ${target}`,
    );
  }
  return assertDeclarationTarget(target, exportName);
}

function reportBaseName(packageName: string, exportName: string): string {
  const safePackageName = packageName
    .replace(/^@/u, '')
    .replaceAll('/', '--')
    .replaceAll(/[^a-zA-Z0-9._-]/gu, '-');
  if (exportName === '.') return safePackageName;

  const suffix = exportName
    .replace(/^\.\//u, '')
    .replaceAll('/', '--')
    .replaceAll(/[^a-zA-Z0-9._-]/gu, '-');
  return `${safePackageName}--${suffix}`;
}

/** Discover the public entry points whose export conditions expose declarations. */
export function collectTypedApiEntries(manifest: unknown): readonly TypedApiEntry[] {
  if (!isRecord(manifest) || typeof manifest['name'] !== 'string') {
    throw new Error('package manifest is missing a valid name');
  }
  const exportsValue = manifest['exports'];
  if (!isRecord(exportsValue)) throw new Error('package manifest is missing an exports map');

  const entries: TypedApiEntry[] = [];
  const reportNames = new Set<string>();
  for (const [exportName, conditions] of Object.entries(exportsValue)) {
    if (!isRecord(conditions)) continue;
    const importTypesTarget = typesTarget(conditions, exportName);
    if (importTypesTarget === undefined) continue;

    const reportName = reportBaseName(manifest['name'], exportName);
    if (reportNames.has(reportName)) {
      throw new Error(`typed exports map to the same API report name: ${reportName}`);
    }
    reportNames.add(reportName);
    entries.push({
      exportName,
      importTypesTarget,
      requirable: isRecord(conditions['default']),
      reportName,
    });
  }
  return entries;
}

function attwEntrypoint(exportName: string): string {
  return exportName === '.' ? '.' : exportName.slice(2);
}

/**
 * The ATTW command, which never asks the tool to repack the source tree. One
 * profile: every entry is an ES module, and the tool's CommonJS resolutions
 * have nothing to check where no CommonJS file exists.
 */
export function buildAttwInvocations(
  tarball: string,
  entries: readonly TypedApiEntry[],
): readonly AttwInvocation[] {
  if (entries.length === 0) return [];
  return [
    {
      label: 'ESM-only',
      args: [
        tarball,
        '--profile',
        'esm-only',
        '--no-definitely-typed',
        '--entrypoints',
        ...entries.map((entry) => attwEntrypoint(entry.exportName)),
        '--format',
        'table',
        '--no-color',
      ],
    },
  ];
}

function formatExtractorMessage(
  messageId: string,
  text: string,
  sourceFilePath: string | undefined,
  sourceFileLine: number | undefined,
): string {
  const location =
    sourceFilePath === undefined
      ? ''
      : ` (${sourceFilePath}${sourceFileLine === undefined ? '' : `:${String(sourceFileLine)}`})`;
  return `${messageId}${location}: ${text}`;
}

/**
 * Compare API Extractor reports with declarations installed from the packed archive.
 *
 * `localBuild` is enabled only for the explicit update command. Normal package checks
 * fail when any generated report differs from the reviewed files in `reportFolder`.
 */
export async function checkApiReports(options: ApiReportCheckOptions): Promise<readonly string[]> {
  await Promise.all([
    mkdir(options.reportFolder, { recursive: true }),
    mkdir(options.reportTempFolder, { recursive: true }),
  ]);
  const baseConfig = ExtractorConfig.loadFile(options.apiConfigPath);
  const failures: string[] = [];
  const expectedReportFiles = new Set(options.entries.map((entry) => `${entry.reportName}.api.md`));
  for (const reportFile of await readdir(options.reportFolder)) {
    if (reportFile.endsWith('.api.md') && !expectedReportFiles.has(reportFile)) {
      failures.push(`stale API report has no typed manifest entry: ${reportFile}`);
    }
  }

  for (const entry of options.entries) {
    const packageRoot = options.packageRootForEntry(entry);
    const entryPoint = resolve(packageRoot, entry.importTypesTarget.slice(2));
    const configObject: IConfigFile = {
      ...baseConfig,
      projectFolder: packageRoot,
      mainEntryPointFilePath: entryPoint,
      compiler: {
        overrideTsconfig: {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            skipLibCheck: false,
          },
          files: [entryPoint],
        },
        skipLibCheck: false,
      },
      apiReport: {
        ...baseConfig.apiReport,
        enabled: true,
        reportFileName: entry.reportName,
        reportFolder: options.reportFolder,
        reportTempFolder: options.reportTempFolder,
      },
    };
    const extractorConfig = ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: options.apiConfigPath,
      packageJsonFullPath: resolve(packageRoot, 'package.json'),
    });
    const messages: string[] = [];
    const result = Extractor.invoke(extractorConfig, {
      localBuild: options.updateReports,
      printApiReportDiff: !options.updateReports,
      showVerboseMessages: false,
      typescriptCompilerFolder: options.typescriptCompilerFolder,
      messageCallback(message) {
        if (options.updateReports && message.messageId === 'console-api-report-created') {
          message.logLevel = ExtractorLogLevel.None;
        }
        if (
          message.logLevel === ExtractorLogLevel.Error ||
          message.logLevel === ExtractorLogLevel.Warning
        ) {
          messages.push(
            formatExtractorMessage(
              message.messageId,
              message.text,
              message.sourceFilePath,
              message.sourceFileLine,
            ),
          );
        }
        message.handled = true;
      },
    });

    if (!result.succeeded || result.errorCount > 0 || result.warningCount > 0) {
      const details = messages.length > 0 ? `\n${messages.join('\n')}` : '';
      failures.push(
        `${entry.exportName} API report failed (${String(result.errorCount)} error(s), ${String(result.warningCount)} warning(s))${details}`,
      );
    }
  }

  let forgottenExportCount = 0;
  for (const reportFile of expectedReportFiles) {
    try {
      const report = await readFile(resolve(options.reportFolder, reportFile), 'utf8');
      forgottenExportCount += [...report.matchAll(/ae-forgotten-export/gu)].length;
    } catch {
      // A missing report is already diagnosed by API Extractor. Avoid replacing
      // that actionable failure with a secondary baseline read error.
    }
  }
  const forgottenExportViolation = findForgottenExportBaselineViolation(forgottenExportCount);
  if (forgottenExportViolation !== undefined) failures.push(forgottenExportViolation);

  return failures;
}
