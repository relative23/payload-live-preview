/**
 * Audit every project against its reviewed advisory and exposure register.
 * Exact dependency and caller identities bind temporary exceptions; expired,
 * unused, malformed or changed exposure records fail before they can allow a finding.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUniqueJson, verifyNoFixTrack } from './audit-registry.mjs';
import { advisoryGraph } from './audit-graph.mjs';
export { advisoryGraph } from './audit-graph.mjs';

export interface AuditException {
  readonly id: string;
  readonly package: string;
  readonly reason: string;
  readonly reachability: string;
  readonly expires: string;
  readonly version?: string;
  readonly integrity?: string;
  readonly graphSha256?: string;
}
export interface AuditRegister {
  readonly schemaVersion: number;
  readonly exceptions: readonly AuditException[];
}
export interface AuditFinding {
  readonly id: string;
  readonly package: string;
  readonly severity: string;
  readonly advisoryPackage?: string;
}
export interface GateResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}
interface Project {
  readonly exposure: string | null;
  readonly exposureSha256: string | null;
  readonly exceptions: readonly AuditException[];
}
type ObjectValue = Record<string, unknown>;
const HIGH = new Set(['high', 'critical']);
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const;
const SHA = /^[a-f\d]{64}$/u;
const GHSA = /^https:\/\/github\.com\/advisories\/GHSA-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}$/u;
const GENERATED = /^(?:node_modules|dist|\.(?:astro|nuxt|output|vercel|netlify))$/u;

function object(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`audit-gate: ${message}`);
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
const readJson = (path: string): unknown => parseUniqueJson(readFileSync(path, 'utf8'));
function contained(root: string, path: string): string {
  requireValue(!isAbsolute(path), `absolute register path ${path}`);
  const full = resolve(root, path);
  const rel = relative(root, full);
  requireValue(rel !== '..' && !rel.startsWith(`..${sep}`), `outside register path ${path}`);
  if (existsSync(full)) {
    const actual = relative(realpathSync(root), realpathSync(full));
    requireValue(actual !== '..' && !actual.startsWith(`..${sep}`), `outside symlink ${path}`);
  }
  return full;
}
function sha(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return 'null';
  }
  return JSON.stringify(value);
}
export const exposureDigest = (value: unknown): string => sha(canonical(value));
/** Keep inherited advisories tied to their actual leaf rather than a package-name id. */
export function findingsFromAudit(auditJson: unknown): AuditFinding[] {
  requireValue(object(auditJson) && auditJson['error'] === undefined, 'invalid audit response');
  const vulnerabilities = auditJson['vulnerabilities'];
  requireValue(object(vulnerabilities), 'audit vulnerabilities are missing');
  requireValue(Object.keys(vulnerabilities).length <= 1_000, 'audit graph exceeds 1000 packages');
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    requireValue(
      object(entry) &&
        SEVERITIES.some((severity) => severity === entry['severity']) &&
        Array.isArray(entry['via']),
      `malformed vulnerability ${name}`,
    );
  }
  const leaves = (start: string): { id: string; leaf: string; severity: string }[] => {
    const seen = new Set<string>();
    const pending = [start];
    const found: { id: string; leaf: string; severity: string }[] = [];
    let edges = 0;
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const entry = vulnerabilities[name];
      requireValue(
        object(entry) && Array.isArray(entry['via']),
        `unresolved advisory edge ${name}`,
      );
      for (const via of entry['via']) {
        requireValue(++edges <= 10_000, 'audit graph exceeds 10000 edges');
        if (typeof via === 'string') {
          pending.push(via);
          continue;
        }
        requireValue(object(via), `malformed advisory in ${name}`);
        const id = typeof via['url'] === 'string' ? via['url'] : via['source'];
        requireValue(typeof id === 'string' && id.length > 0, `missing advisory id in ${name}`);
        requireValue(
          typeof via['severity'] === 'string' &&
            SEVERITIES.some((severity) => severity === via['severity']),
          `invalid leaf severity in ${name}`,
        );
        found.push({ id, leaf: name, severity: via['severity'] });
      }
    }
    return found;
  };
  const findings: AuditFinding[] = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    requireValue(object(entry), `malformed vulnerability ${name}`);
    const found = leaves(name);
    requireValue(found.length > 0, `no leaf advisory for ${name}`);
    const rank = (severity: string): number => SEVERITIES.findIndex((value) => value === severity);
    requireValue(
      Math.max(...found.map(({ severity }) => rank(severity))) ===
        rank(entry['severity'] as string),
      `inconsistent severity for ${name}`,
    );
    const seen = new Set<string>();
    for (const { id, leaf, severity } of found) {
      if (!HIGH.has(severity)) continue;
      const key = `${id}:${leaf}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ id, package: name, severity, advisoryPackage: leaf });
    }
  }
  return findings;
}
/** Every selected exception must be used; another project never supplies one. */
export function evaluateAuditGate(
  findings: readonly AuditFinding[],
  register: AuditRegister,
  today: Date,
): GateResult {
  const violations: string[] = [];
  const used = new Set<AuditException>();
  for (const finding of findings) {
    const exception = register.exceptions.find(
      (candidate) =>
        candidate.package === (finding.advisoryPackage ?? finding.package) &&
        candidate.id === finding.id,
    );
    if (exception === undefined) {
      violations.push(
        `${finding.severity} advisory in ${finding.package} (${finding.id}) has no reviewed exception`,
      );
      continue;
    }
    const expiry = Date.parse(exception.expires);
    if (Number.isNaN(expiry)) {
      violations.push(`exception for ${exception.package} has an unparseable expires date`);
    } else if (expiry < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
      violations.push(
        `exception for ${exception.package} expired ${exception.expires}; re-triage or remove it`,
      );
    }
    used.add(exception);
  }
  for (const exception of register.exceptions) {
    if (!used.has(exception)) {
      violations.push(
        `exception for ${exception.package} (${exception.id}) matches no current advisory; remove it`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}
/** Select only exact repository projects, while validating even inactive entries. */
export function selectAuditProject(
  input: unknown,
  root: string,
  prefix: string | undefined,
  today: Date,
): { key: string; project: Project } {
  requireValue(
    object(input) && input['schemaVersion'] === 2 && object(input['projects']),
    'register schema must be 2 with projects',
  );
  const projects = input['projects'];
  const day = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const [key, value] of Object.entries(projects)) {
    requireValue(
      key === '.' ||
        (!isAbsolute(key) &&
          key === key.replaceAll('\\', '/').replace(/\/$/u, '') &&
          !key.split('/').some((part) => part === '.' || part === '..' || part === '')),
      `invalid project ${key}`,
    );
    contained(root, key);
    requireValue(
      object(value) &&
        Array.isArray(value['exceptions']) &&
        (value['exposure'] === null || typeof value['exposure'] === 'string'),
      `invalid project record ${key}`,
    );
    requireValue(
      value['exceptions'].length === 0
        ? value['exposure'] === null && value['exposureSha256'] === null
        : typeof value['exposure'] === 'string' &&
            value['exposure'].length > 0 &&
            typeof value['exposureSha256'] === 'string' &&
            SHA.test(value['exposureSha256']),
      `invalid exposure binding ${key}`,
    );
    const seen = new Set<string>();
    for (const entry of value['exceptions']) {
      requireValue(object(entry), `invalid exception in ${key}`);
      requireValue(
        typeof entry['id'] === 'string' &&
          GHSA.test(entry['id']) &&
          typeof entry['package'] === 'string' &&
          entry['package'].length > 0,
        `invalid advisory identity in ${key}`,
      );
      for (const name of ['version', 'reason', 'reachability']) {
        requireValue(
          typeof entry[name] === 'string' && entry[name].trim().length > 0,
          `missing ${name} in ${key}`,
        );
      }
      requireValue(
        typeof entry['version'] === 'string' && /^\d+\.\d+\.\d+$/u.test(entry['version']),
        `invalid stable leaf version in ${key}`,
      );
      requireValue(
        typeof entry['integrity'] === 'string' &&
          /^sha512-[A-Za-z\d+/]+=*$/u.test(entry['integrity']) &&
          Buffer.from(entry['integrity'].slice(7), 'base64').length === 64,
        `missing integrity in ${key}`,
      );
      requireValue(
        typeof entry['graphSha256'] === 'string' && SHA.test(entry['graphSha256']),
        `invalid graph in ${key}`,
      );
      const expires = entry['expires'];
      requireValue(
        typeof expires === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/u.test(expires) &&
          new Date(expires).toISOString().slice(0, 10) === expires &&
          Date.parse(expires) >= day,
        `invalid or expired exception in ${key}`,
      );
      const id = `${entry['package']}:${entry['id']}`;
      requireValue(!seen.has(id), `duplicate exception in ${key}`);
      seen.add(id);
      requireValue(typeof value['exposure'] === 'string', `missing exposure in ${key}`);
    }
    if (typeof value['exposure'] === 'string') contained(root, value['exposure']);
  }
  const full = resolve(root, prefix ?? '.');
  const rel = relative(root, full).replaceAll(sep, '/');
  const key = rel === '' ? '.' : rel;
  requireValue(Object.hasOwn(projects, key), `unknown audit project ${key}`);
  contained(root, key);
  return { key, project: projects[key] as Project };
}

function sourceFiles(root: string, directory: string, top = directory): string[] {
  const full = contained(root, directory);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    // A content entry may use any suffix; generated trees stay outside the reviewed set.
    if (GENERATED.test(entry.name)) return [];
    if (directory === top && /^package(?:-lock)?\.json$/u.test(entry.name)) return [];
    requireValue(!entry.isSymbolicLink(), `source symlink ${directory}/${entry.name}`);
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(root, path, top) : [path];
  });
}

/** Source sets and security projections detect drift without pinning version metadata. */
export function validateExposure(input: unknown, root: string, lock: unknown): void {
  requireValue(
    object(input) &&
      object(input['sources']) &&
      Object.keys(input['sources']).length > 0 &&
      strings(input['directories']) &&
      strings(input['absentFiles']) &&
      Array.isArray(input['json']) &&
      input['json'].length > 0 &&
      object(input['callers']) &&
      Object.keys(input['callers']).length > 0,
    'malformed exposure',
  );
  const sources = input['sources'];
  const directories = input['directories'];
  requireValue(object(lock) && object(lock['packages']), 'missing lock packages');
  for (const path of input['absentFiles']) {
    requireValue(!existsSync(contained(root, path)), `exposure file appeared ${path}`);
  }
  for (const [path, digest] of Object.entries(sources)) {
    requireValue(typeof digest === 'string' && SHA.test(digest), `invalid source digest ${path}`);
    requireValue(
      sha(readFileSync(contained(root, path))) === digest,
      `source exposure changed ${path}`,
    );
  }
  const actual = directories.flatMap((directory) => sourceFiles(root, directory)).sort();
  const expected = Object.keys(sources)
    .filter((path) => directories.some((directory) => path.startsWith(`${directory}/`)))
    .sort();
  requireValue(canonical(actual) === canonical(expected), 'source exposure set changed');
  for (const projection of input['json']) {
    requireValue(
      object(projection) &&
        typeof projection['path'] === 'string' &&
        object(projection['values']) &&
        strings(projection['absent']) &&
        (Object.keys(projection['values']).length > 0 || projection['absent'].length > 0),
      'malformed JSON exposure',
    );
    const value = readJson(contained(root, projection['path']));
    requireValue(object(value), `invalid projected JSON ${projection['path']}`);
    for (const [key, expectedValue] of Object.entries(projection['values'])) {
      requireValue(
        Object.hasOwn(value, key) && canonical(value[key]) === canonical(expectedValue),
        `JSON exposure changed ${projection['path']}:${key}`,
      );
    }
    for (const key of projection['absent']) {
      requireValue(
        !Object.hasOwn(value, key),
        `JSON exposure appeared ${projection['path']}:${key}`,
      );
    }
  }
  for (const [path, expectedIdentity] of Object.entries(input['callers'])) {
    requireValue(
      strings(expectedIdentity) && expectedIdentity.length === 2,
      `invalid caller ${path}`,
    );
    const value = lock['packages'][path];
    requireValue(
      object(value) &&
        value['version'] === expectedIdentity[0] &&
        value['integrity'] === expectedIdentity[1],
      `caller identity changed ${path}`,
    );
  }
}

/** An npm error, timeout or incomplete body cannot supply a clean audit. */
export function readAuditResponse(result: {
  status: number | null;
  signal?: string | null;
  error?: unknown;
  stdout?: string;
}): unknown {
  requireValue(
    result.error === undefined &&
      (result.signal === undefined || result.signal === null) &&
      (result.status === 0 || result.status === 1),
    'npm audit did not complete normally',
  );
  const input = parseUniqueJson(result.stdout ?? '');
  requireValue(
    object(input) &&
      input['error'] === undefined &&
      object(input['vulnerabilities']) &&
      object(input['metadata']) &&
      object(input['metadata']['vulnerabilities']),
    'incomplete npm audit response',
  );
  const counts = input['metadata']['vulnerabilities'];
  for (const name of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    requireValue(
      typeof counts[name] === 'number' && Number.isInteger(counts[name]) && counts[name] >= 0,
      `invalid audit count ${name}`,
    );
  }
  for (const severity of SEVERITIES) {
    requireValue(
      Object.values(input['vulnerabilities']).filter(
        (entry) => object(entry) && entry['severity'] === severity,
      ).length === counts[severity],
      `inconsistent audit count ${severity}`,
    );
  }
  requireValue(
    SEVERITIES.reduce((total, severity) => total + (counts[severity] as number), 0) ===
      counts['total'],
    'inconsistent audit total',
  );
  return input;
}

function main(argv: readonly string[]): number {
  const prefixIndex = argv.indexOf('--prefix');
  requireValue(
    argv.filter((arg) => arg === '--prefix').length <= 1 &&
      argv.filter((arg) => arg === '--package-lock-only').length <= 1,
    'duplicate audit argument',
  );
  requireValue(
    argv.every(
      (arg, index) =>
        arg === '--package-lock-only' ||
        arg === '--prefix' ||
        (index === prefixIndex + 1 && prefixIndex !== -1),
    ),
    'unknown audit argument',
  );
  requireValue(
    prefixIndex === -1 ||
      (typeof argv[prefixIndex + 1] === 'string' && !argv[prefixIndex + 1]?.startsWith('--')),
    'missing audit prefix',
  );
  const root = process.cwd();
  const today = new Date();
  const selected = selectAuditProject(
    readJson(resolve(root, 'quality/audit-exceptions.json')),
    root,
    prefixIndex === -1 ? undefined : argv[prefixIndex + 1],
    today,
  );
  const args = [
    'audit',
    '--json',
    '--include=dev',
    ...(argv.includes('--package-lock-only') ? ['--package-lock-only'] : []),
    ...(selected.key === '.' ? [] : ['--prefix', selected.key]),
  ];
  const audit = readAuditResponse(
    spawnSync('npm', args, {
      encoding: 'utf8',
      timeout: 60_000,
      killSignal: 'SIGKILL',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const findings = findingsFromAudit(audit);
  const lock = readJson(resolve(root, selected.key, 'package-lock.json'));
  if (selected.project.exposure !== null) {
    const descriptor = readJson(contained(root, selected.project.exposure));
    requireValue(
      exposureDigest(descriptor) === selected.project.exposureSha256,
      'changed exposure descriptor',
    );
    validateExposure(descriptor, root, lock);
  }
  for (const exception of selected.project.exceptions) {
    if (
      !findings.some(
        (finding) => finding.id === exception.id && finding.advisoryPackage === exception.package,
      )
    ) {
      continue;
    }
    const graph = advisoryGraph(audit, lock, findings, exception.package, exception.id);
    requireValue(
      graph.sha256 === exception.graphSha256 &&
        graph.version === exception.version &&
        graph.integrity === exception.integrity,
      `advisory graph changed ${selected.key}:${exception.package}`,
    );
    verifyNoFixTrack(exception.package, graph.version);
  }
  const result = evaluateAuditGate(
    findings,
    { schemaVersion: 1, exceptions: selected.project.exceptions },
    today,
  );
  if (!result.ok) {
    process.stderr.write(
      `audit gate failed for ${selected.key}:\n${result.violations.map((item) => `- ${item}`).join('\n')}\n`,
    );
    return 1;
  }
  process.stdout.write(
    `Audit gate passed for ${selected.key}: ${findings.length} high/critical affected-package findings, ${selected.project.exceptions.length} exact reviewed advisory exceptions.\n`,
  );
  return 0;
}
const invokedPath = process.argv[1] === undefined ? undefined : realpathSync(process.argv[1]);
if (invokedPath !== undefined && realpathSync(fileURLToPath(import.meta.url)) === invokedPath) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'audit-gate: unknown failure'}\n`,
    );
    process.exitCode = 1;
  }
}
