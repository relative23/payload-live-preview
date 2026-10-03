import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
      via: [{ url: 'https://github.com/advisories/GHSA-xxxx', severity: 'high' }],
    },
    lodash: { severity: 'moderate', via: [{ url: 'GHSA-low', severity: 'moderate' }] },
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
          via: [
            { url: 'GHSA-one', severity: 'critical' },
            { source: 'GHSA-two', severity: 'critical' },
            'qs',
          ],
        },
      },
    });
    expect(findings.map(({ id }) => id)).toEqual(['GHSA-one', 'GHSA-two']);
  });

  it('is empty for a clean audit', () => {
    expect(findingsFromAudit({ vulnerabilities: {} })).toEqual([]);
    expect(() => findingsFromAudit(null)).toThrow();
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
          via: [{ url: 'https://github.com/advisories/GHSA-new', severity: 'critical' }],
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
  it('does not skip main() through a symlink alias', () => {
    const root = mkdtempSync(join(tmpdir(), 'plp audit gäte-'));
    try {
      mkdirSync(join(root, 'quality'));
      writeFileSync(
        join(root, 'quality/audit-exceptions.json'),
        JSON.stringify({
          schemaVersion: 2,
          projects: { '.': { exposure: null, exposureSha256: null, exceptions: [] } },
        }),
      );
      const script = join(root, 'audit gate.ts');
      const alias = join(root, 'audït alias.ts');
      copyFileSync(resolve(process.cwd(), 'scripts/audit-gate.ts'), script);
      copyFileSync(
        resolve(process.cwd(), 'scripts/audit-registry.mjs'),
        join(root, 'audit-registry.mjs'),
      );
      copyFileSync(
        resolve(process.cwd(), 'scripts/audit-graph.mjs'),
        join(root, 'audit-graph.mjs'),
      );
      symlinkSync(script, alias);
      const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
      const loader = pathToFileURL(resolve(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href;
      // Native stripping exercises the CI entrypoint; older supported Node uses the same CLI through tsx.
      const args =
        major > 22 || (major === 22 && minor >= 18) ? [alias] : ['--import', loader, alias];
      const result = spawnSync(process.execPath, [...args, '--prefix', 'unregistered'], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10_000,
        killSignal: 'SIGKILL',
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('unknown audit project');
      expect(result.stdout).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it.each(['unregistered', '../outside', '/outside'])(
    'refuses an unknown or outside CLI project %s before auditing',
    (prefix) => {
      const root = mkdtempSync(join(tmpdir(), 'plp audit gäte-'));
      try {
        mkdirSync(join(root, 'quality'));
        writeFileSync(
          join(root, 'quality/audit-exceptions.json'),
          JSON.stringify({
            schemaVersion: 2,
            projects: { '.': { exposure: null, exposureSha256: null, exceptions: [] } },
          }),
        );
        const script = join(root, 'audit gate.ts');
        copyFileSync(resolve(process.cwd(), 'scripts/audit-gate.ts'), script);
        copyFileSync(
          resolve(process.cwd(), 'scripts/audit-registry.mjs'),
          join(root, 'audit-registry.mjs'),
        );
        copyFileSync(
          resolve(process.cwd(), 'scripts/audit-graph.mjs'),
          join(root, 'audit-graph.mjs'),
        );
        const loader = pathToFileURL(
          resolve(process.cwd(), 'node_modules/tsx/dist/loader.mjs'),
        ).href;
        const result = spawnSync(
          process.execPath,
          ['--import', loader, script, '--prefix', prefix],
          { cwd: root, encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL' },
        );
        expect(result.error).toBeUndefined();
        expect(result.signal).toBeNull();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('unknown audit project');
        expect(result.stdout).toBe('');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it('runs main() when invoked through a path with spaces and non-ASCII characters', () => {
    const root = mkdtempSync(join(tmpdir(), 'plp audit gäte-'));
    try {
      mkdirSync(join(root, 'quality'));
      writeFileSync(
        join(root, 'quality/audit-exceptions.json'),
        JSON.stringify({
          schemaVersion: 2,
          projects: { consumer: { exposure: null, exposureSha256: null, exceptions: [] } },
        }),
      );
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
      copyFileSync(
        resolve(process.cwd(), 'scripts/audit-registry.mjs'),
        join(root, 'audit-registry.mjs'),
      );
      copyFileSync(
        resolve(process.cwd(), 'scripts/audit-graph.mjs'),
        join(root, 'audit-graph.mjs'),
      );
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
