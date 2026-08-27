/**
 * The reviewed npm audit gate (roadmap 1.9.0 supply-chain). It fails on any
 * high or critical advisory that is not covered by a non-expired exception in
 * `quality/audit-exceptions.json`, and it fails on an expired or unused
 * exception too, so the register cannot rot. A bare `npm audit --audit-level`
 * has no way to say "this one is triaged, reachable-only-in-X, fixed by date";
 * this gate is that register.
 *
 * Run: `tsx scripts/audit-gate.ts [--prefix <dir>]`. The exception register
 * governs the maintainer tree; fixtures keep the plain `npm audit` in CI.
 *
 * @module scripts/audit-gate
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AuditException {
  /** The advisory id (a GHSA identifier) this exception covers. */
  readonly id: string;
  /** The vulnerable package. */
  readonly package: string;
  /** Why it is tolerated for now — the triage decision. */
  readonly reason: string;
  /** Where (or whether) the advisory is reachable from this package. */
  readonly reachability: string;
  /** ISO date (YYYY-MM-DD) after which the exception no longer applies. */
  readonly expires: string;
}

export interface AuditRegister {
  readonly schemaVersion: number;
  readonly exceptions: readonly AuditException[];
}

/** One high/critical advisory as the gate needs to see it. */
export interface AuditFinding {
  readonly id: string;
  readonly package: string;
  readonly severity: string;
}

const HIGH_OR_CRITICAL = new Set(['high', 'critical']);

/** Coerce a value to a string only when it already is one; anything else is ''. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The high/critical advisories in an `npm audit --json` document. */
export function findingsFromAudit(auditJson: unknown): AuditFinding[] {
  const findings: AuditFinding[] = [];
  if (typeof auditJson !== 'object' || auditJson === null) return findings;
  const vulnerabilities = (auditJson as { vulnerabilities?: Record<string, unknown> })
    .vulnerabilities;
  if (vulnerabilities === undefined) return findings;
  for (const [pkg, entry] of Object.entries(vulnerabilities)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const severity = asString((entry as { severity?: unknown }).severity);
    if (!HIGH_OR_CRITICAL.has(severity)) continue;
    const via = (entry as { via?: unknown }).via;
    const ids = Array.isArray(via)
      ? via
          .map((v) =>
            typeof v === 'object' && v !== null
              ? asString((v as { url?: unknown }).url) ||
                asString((v as { source?: unknown }).source)
              : '',
          )
          .filter((id) => id.length > 0)
      : [];
    findings.push({ id: ids[0] ?? pkg, package: pkg, severity });
  }
  return findings;
}

export interface GateResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/**
 * Decide the gate from the findings, the register, and today's date. Pure, so
 * the policy is unit-testable without a network or a real audit.
 */
export function evaluateAuditGate(
  findings: readonly AuditFinding[],
  register: AuditRegister,
  today: Date,
): GateResult {
  const violations: string[] = [];
  const used = new Set<string>();
  const now = today.getTime();

  for (const finding of findings) {
    const exception = register.exceptions.find(
      (candidate) => candidate.package === finding.package || candidate.id === finding.id,
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
    } else if (expiry < now) {
      violations.push(
        `exception for ${exception.package} expired ${exception.expires}; re-triage or remove it`,
      );
    }
    used.add(exception.id);
  }

  for (const exception of register.exceptions) {
    if (!used.has(exception.id)) {
      violations.push(
        `exception for ${exception.package} (${exception.id}) matches no current advisory; remove it`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

function runAudit(prefix: string | undefined): unknown {
  const args = ['audit', '--json', ...(prefix !== undefined ? ['--prefix', prefix] : [])];
  let stdout: string;
  try {
    stdout = execFileSync('npm', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero when advisories exist; the JSON is still on stdout.
    stdout = asString((error as { stdout?: unknown }).stdout);
  }
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error('audit-gate: could not parse `npm audit --json` output');
  }
}

function main(argv: readonly string[]): number {
  const prefixIndex = argv.indexOf('--prefix');
  const prefix = prefixIndex !== -1 ? argv[prefixIndex + 1] : undefined;
  const registerPath = resolve(process.cwd(), 'quality/audit-exceptions.json');
  const register = JSON.parse(readFileSync(registerPath, 'utf8')) as AuditRegister;
  const findings = findingsFromAudit(runAudit(prefix));
  const result = evaluateAuditGate(findings, register, new Date());
  if (result.ok) {
    process.stdout.write(
      `Audit gate passed: ${String(findings.length)} high/critical advisor${findings.length === 1 ? 'y' : 'ies'}, all covered by reviewed exceptions.\n`,
    );
    return 0;
  }
  process.stderr.write('audit gate failed:\n');
  for (const violation of result.violations) process.stderr.write(`- ${violation}\n`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
