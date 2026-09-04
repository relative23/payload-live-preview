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
  readonly requireTypesTarget: string | undefined;
  readonly reportName: string;
}

export interface AttwInvocation {
  readonly label: 'dual-format' | 'ESM-only';
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
 */
export const FORGOTTEN_EXPORT_BASELINE = 59;

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

function conditionExists(value: JsonRecord, condition: 'import' | 'require'): boolean {
  const branch = value[condition];
  return typeof branch === 'string' || isRecord(branch);
}

function assertDeclarationTarget(target: string, exportName: string): string {
  const segments = target.slice(2).split('/');
  if (
    !target.startsWith('./') ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !/\.d\.(?:c|m)?ts$/u.test(target)
  ) {
    throw new Error(`${exportName} exposes an unsafe or non-declaration types target: ${target}`);
  }
  return target;
}

function typesTarget(
  value: JsonRecord,
  exportName: string,
  condition: 'import' | 'require',
): string | undefined {
  const branch = value[condition];
  if (isRecord(branch) && typeof branch['types'] === 'string') {
    return assertDeclarationTarget(branch['types'], exportName);
  }

  const sharedTarget = value['types'];
  if (typeof sharedTarget !== 'string') return undefined;
  if (conditionExists(value, condition)) {
    return assertDeclarationTarget(sharedTarget, exportName);
  }
  return condition === 'import' ? assertDeclarationTarget(sharedTarget, exportName) : undefined;
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
    const importTypesTarget = typesTarget(conditions, exportName, 'import');
    const requireTypesTarget = typesTarget(conditions, exportName, 'require');
    const primaryTarget = importTypesTarget ?? requireTypesTarget;
    if (primaryTarget === undefined) continue;

    const reportName = reportBaseName(manifest['name'], exportName);
    if (reportNames.has(reportName)) {
      throw new Error(`typed exports map to the same API report name: ${reportName}`);
    }
    reportNames.add(reportName);
    entries.push({
      exportName,
      importTypesTarget: primaryTarget,
      requireTypesTarget,
      reportName,
    });
  }
  return entries;
}

function attwEntrypoint(exportName: string): string {
  return exportName === '.' ? '.' : exportName.slice(2);
}

/** Build ATTW commands without ever asking the tool to repack the source tree. */
export function buildAttwInvocations(
  tarball: string,
  entries: readonly TypedApiEntry[],
): readonly AttwInvocation[] {
  const dualFormat = entries
    .filter((entry) => entry.requireTypesTarget !== undefined)
    .map((entry) => attwEntrypoint(entry.exportName));
  const esmOnly = entries
    .filter((entry) => entry.requireTypesTarget === undefined)
    .map((entry) => attwEntrypoint(entry.exportName));
  const invocations: AttwInvocation[] = [];

  if (dualFormat.length > 0) {
    invocations.push({
      label: 'dual-format',
      args: [
        tarball,
        '--profile',
        'node16',
        '--no-definitely-typed',
        '--entrypoints',
        ...dualFormat,
        '--format',
        'table',
        '--no-color',
      ],
    });
  }
  if (esmOnly.length > 0) {
    invocations.push({
      label: 'ESM-only',
      args: [
        tarball,
        '--profile',
        'esm-only',
        '--no-definitely-typed',
        '--entrypoints',
        ...esmOnly,
        '--format',
        'table',
        '--no-color',
      ],
    });
  }
  return invocations;
}

/**
 * Keep dual-format declarations one public contract.
 *
 * API Extractor reads the ESM declaration entry while ATTW and the compiler
 * exercise both resolution branches. Requiring byte-identical `.d.ts` and
 * `.d.cts` output closes the remaining drift seam without maintaining two API
 * snapshots for what is intentionally the same 1.x surface.
 */
export async function checkDualDeclarationParity(
  entries: readonly TypedApiEntry[],
  packageRootForEntry: (entry: TypedApiEntry) => string,
): Promise<readonly string[]> {
  const failures: string[] = [];
  for (const entry of entries) {
    if (entry.requireTypesTarget === undefined) continue;
    const packageRoot = packageRootForEntry(entry);
    const [importDeclaration, requireDeclaration] = await Promise.all([
      readFile(resolve(packageRoot, entry.importTypesTarget.slice(2))),
      readFile(resolve(packageRoot, entry.requireTypesTarget.slice(2))),
    ]);
    if (!importDeclaration.equals(requireDeclaration)) {
      failures.push(
        `${entry.exportName} import/require declarations differ: ${entry.importTypesTarget} != ${entry.requireTypesTarget}`,
      );
    }
  }
  return failures;
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
