import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  evaluateAuditGate,
  findingsFromAudit,
  type AuditException,
  type AuditRegister,
} from '../../../scripts/audit-gate';

const AUDIT = {
  vulnerabilities: {
    'left-pad': {
      severity: 'high',
      via: [{ url: 'https://github.com/advisories/GHSA-xxxx' }],
    },
    lodash: { severity: 'moderate', via: [] },
  },
};

function register(exceptions: AuditRegister['exceptions']): AuditRegister {
  return { schemaVersion: 1, exceptions };
}

const exception = (overrides: Partial<AuditException> = {}): AuditException => ({
  id: 'https://github.com/advisories/GHSA-xxxx',
  package: 'left-pad',
  reason: 'dev-only transitive',
  reachability: 'not reachable from the published bundle',
  expires: '2026-12-31',
  ...overrides,
});

describe('findingsFromAudit', () => {
  it('keeps only high and critical advisories', () => {
    const findings = findingsFromAudit(AUDIT);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'left-pad', severity: 'high' });
  });

  it('reports every advisory of a package separately', () => {
    const findings = findingsFromAudit({
      vulnerabilities: {
        qs: {
          severity: 'critical',
          via: [{ url: 'GHSA-one' }, { source: 'GHSA-two' }, 'qs'],
        },
      },
    });
    expect(findings.map(({ id }) => id)).toEqual(['GHSA-one', 'GHSA-two']);
  });

  it('is empty for a clean audit', () => {
    expect(findingsFromAudit({ vulnerabilities: {} })).toEqual([]);
    expect(findingsFromAudit(null)).toEqual([]);
  });
});

describe('evaluateAuditGate', () => {
  const today = new Date('2026-08-27');
  const findings = findingsFromAudit(AUDIT);

  it('fails an advisory with no exception', () => {
    const result = evaluateAuditGate(findings, register([]), today);
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('no reviewed exception');
  });

  it('passes an advisory covered by a non-expired exception', () => {
    expect(evaluateAuditGate(findings, register([exception()]), today).ok).toBe(true);
  });

  it('does not let an exception for one advisory cover a later advisory in the same package', () => {
    const newer = findingsFromAudit({
      vulnerabilities: {
        'left-pad': {
          severity: 'critical',
          via: [{ url: 'https://github.com/advisories/GHSA-new' }],
        },
      },
    });
    const result = evaluateAuditGate(newer, register([exception()]), today);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      'critical advisory in left-pad (https://github.com/advisories/GHSA-new) has no reviewed exception',
      'exception for left-pad (https://github.com/advisories/GHSA-xxxx) matches no current advisory; remove it',
    ]);
  });

  it('does not let an exception for one package cover the same advisory id elsewhere', () => {
    const result = evaluateAuditGate(findings, register([exception({ package: 'other' })]), today);
    expect(result.ok).toBe(false);
  });

  it('fails an expired exception', () => {
    const result = evaluateAuditGate(
      findings,
      register([exception({ expires: '2026-01-01' })]),
      today,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('expired');
  });

  it('fails an unused exception so the register cannot rot', () => {
    const result = evaluateAuditGate(
      [],
      register([exception({ id: 'GHSA-unused', package: 'ghost' })]),
      today,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('matches no current advisory');
  });

  it('passes a clean tree with an empty register', () => {
    expect(evaluateAuditGate([], register([]), today).ok).toBe(true);
  });
});

describe('audit-gate entry point', () => {
  it('runs main() when invoked through a path with spaces and non-ASCII characters', () => {
    const root = mkdtempSync(join(tmpdir(), 'plp audit gäte-'));
    try {
      mkdirSync(join(root, 'quality'));
      writeFileSync(join(root, 'quality/audit-exceptions.json'), JSON.stringify(register([])));
      const consumer = join(root, 'consumer');
      mkdirSync(consumer);
      writeFileSync(
        join(consumer, 'package.json'),
        '{"name":"c","version":"0.0.0","private":true}\n',
      );
      writeFileSync(
        join(consumer, 'package-lock.json'),
        '{"name":"c","version":"0.0.0","lockfileVersion":3,"packages":{"":{"name":"c","version":"0.0.0"}}}\n',
      );
      const script = join(root, 'audit gate.ts');
      copyFileSync(resolve(process.cwd(), 'scripts/audit-gate.ts'), script);
      // The loader is addressed by URL: the copy runs outside the repository,
      // where a bare `tsx` specifier has no node_modules to resolve against.
      const loader = pathToFileURL(resolve(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href;
      const output = execFileSync(
        process.execPath,
        ['--import', loader, script, '--prefix', consumer],
        { cwd: root, encoding: 'utf8' },
      );
      expect(output).toContain('Audit gate passed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
