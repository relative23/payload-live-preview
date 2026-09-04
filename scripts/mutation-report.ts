/**
 * Fail-closed parsing of a Stryker JSON report. Every field the policy later
 * compares is validated here, so a truncated or reshaped report is rejected
 * instead of silently summarising as a passing baseline.
 */

const TERMINAL_STATUSES = new Set([
  'CompileError',
  'Ignored',
  'Killed',
  'NoCoverage',
  'RuntimeError',
  'Survived',
  'Timeout',
]);

export interface MutationSummary {
  readonly total: number;
  readonly killed: number;
  readonly survived: number;
  readonly noCoverage: number;
  readonly timeout: number;
  readonly errors: number;
  readonly ignored: number;
  readonly mutationScore: number;
}

export interface ParsedMutationReport {
  readonly schemaVersion: string;
  readonly frameworkName: string;
  readonly frameworkVersion: string;
  readonly configFile: string;
  readonly configuredScope: readonly string[];
  readonly testRunner: string;
  readonly vitestConfigFile: string;
  readonly vitestRelated: boolean;
  readonly coverageAnalysis: string;
  readonly incremental: boolean;
  readonly thresholds: {
    readonly high: number;
    readonly low: number;
    readonly break: number | null;
  };
  readonly excludedMutations: readonly unknown[];
  readonly ignorers: readonly unknown[];
  readonly fileStatuses: ReadonlyMap<string, readonly string[]>;
  readonly fileSources: ReadonlyMap<string, string>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  return value;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
  return value;
}

function arrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  return arrayValue(value, label).map((entry, index) =>
    stringValue(entry, `${label}[${String(index)}]`),
  );
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//u, '');
}

export function normalizeSource(source: string): string {
  return source.replaceAll('\r\n', '\n');
}

export function sortedUniquePaths(paths: readonly string[], label: string): readonly string[] {
  const normalized = paths.map(normalizePath);
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) throw new Error(`${label} contains duplicate paths`);
  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function formatList(values: readonly string[]): string {
  return `[${values.join(', ')}]`;
}

export function parseMutationReport(input: unknown): ParsedMutationReport {
  const report = record(input, 'mutation report');
  const framework = record(report['framework'], 'mutation report.framework');
  const config = record(report['config'], 'mutation report.config');
  const vitest = record(config['vitest'], 'mutation report.config.vitest');
  const mutator = record(config['mutator'], 'mutation report.config.mutator');
  const thresholds = record(config['thresholds'], 'mutation report.config.thresholds');
  const files = record(report['files'], 'mutation report.files');
  const fileStatuses = new Map<string, readonly string[]>();
  const fileSources = new Map<string, string>();

  for (const [rawPath, rawFile] of Object.entries(files)) {
    const path = normalizePath(rawPath);
    if (fileStatuses.has(path)) throw new Error(`mutation report has duplicate file ${path}`);
    const file = record(rawFile, `mutation report.files[${rawPath}]`);
    const mutants = arrayValue(file['mutants'], `mutation report.files[${rawPath}].mutants`);
    const statuses = mutants.map((rawMutant, index) => {
      const mutant = record(
        rawMutant,
        `mutation report.files[${rawPath}].mutants[${String(index)}]`,
      );
      return stringValue(
        mutant['status'],
        `mutation report.files[${rawPath}].mutants[${String(index)}].status`,
      );
    });
    fileStatuses.set(path, statuses);
    fileSources.set(path, stringValue(file['source'], `mutation report.files[${rawPath}].source`));
  }

  return {
    schemaVersion: stringValue(report['schemaVersion'], 'mutation report.schemaVersion'),
    frameworkName: stringValue(framework['name'], 'mutation report.framework.name'),
    frameworkVersion: stringValue(framework['version'], 'mutation report.framework.version'),
    configFile: stringValue(config['configFile'], 'mutation report.config.configFile'),
    configuredScope: stringArray(config['mutate'], 'mutation report.config.mutate'),
    testRunner: stringValue(config['testRunner'], 'mutation report.config.testRunner'),
    vitestConfigFile: stringValue(vitest['configFile'], 'mutation report.config.vitest.configFile'),
    vitestRelated: booleanValue(vitest['related'], 'mutation report.config.vitest.related'),
    coverageAnalysis: stringValue(
      config['coverageAnalysis'],
      'mutation report.config.coverageAnalysis',
    ),
    incremental: booleanValue(config['incremental'], 'mutation report.config.incremental'),
    thresholds: {
      high: numberValue(thresholds['high'], 'mutation report.config.thresholds.high'),
      low: numberValue(thresholds['low'], 'mutation report.config.thresholds.low'),
      break:
        thresholds['break'] === null
          ? null
          : numberValue(thresholds['break'], 'mutation report.config.thresholds.break'),
    },
    excludedMutations: arrayValue(
      mutator['excludedMutations'],
      'mutation report.config.mutator.excludedMutations',
    ),
    ignorers: arrayValue(config['ignorers'], 'mutation report.config.ignorers'),
    fileStatuses,
    fileSources,
  };
}

export function summarizeParsedReport(report: ParsedMutationReport): MutationSummary {
  const counts = {
    killed: 0,
    survived: 0,
    noCoverage: 0,
    timeout: 0,
    errors: 0,
    ignored: 0,
  };

  for (const statuses of report.fileStatuses.values()) {
    for (const status of statuses) {
      if (!TERMINAL_STATUSES.has(status)) {
        throw new Error(
          `unsupported mutant status ${status}; report is incomplete or incompatible`,
        );
      }
      switch (status) {
        case 'Killed':
          counts.killed += 1;
          break;
        case 'Survived':
          counts.survived += 1;
          break;
        case 'NoCoverage':
          counts.noCoverage += 1;
          break;
        case 'Timeout':
          counts.timeout += 1;
          break;
        case 'CompileError':
        case 'RuntimeError':
          counts.errors += 1;
          break;
        case 'Ignored':
          counts.ignored += 1;
          break;
      }
    }
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const scored = counts.killed + counts.timeout + counts.survived + counts.noCoverage;
  const mutationScore = scored === 0 ? 100 : ((counts.killed + counts.timeout) / scored) * 100;
  return { total, ...counts, mutationScore };
}

export function summarizeMutationReport(input: unknown): MutationSummary {
  return summarizeParsedReport(parseMutationReport(input));
}
