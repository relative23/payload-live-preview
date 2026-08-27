import { describe, expect, it } from 'vitest';
import {
  evaluateAuditGate,
  findingsFromAudit,
  type AuditRegister,
} from '../../../scripts/audit-gate';

/**
 * The reviewed audit gate (roadmap 1.9.0). A high/critical advisory passes
 * only while a non-expired exception covers it; an expired or unused
 * exception is itself a failure so the register cannot rot.
 */

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

describe('findingsFromAudit', () => {
  it('keeps only high and critical advisories', () => {
    const findings = findingsFromAudit(AUDIT);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ package: 'left-pad', severity: 'high' });
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
    const result = evaluateAuditGate(
      findings,
      register([
        {
          id: 'https://github.com/advisories/GHSA-xxxx',
          package: 'left-pad',
          reason: 'dev-only transitive',
          reachability: 'not reachable from the published bundle',
          expires: '2026-12-31',
        },
      ]),
      today,
    );
    expect(result.ok).toBe(true);
  });

  it('fails an expired exception', () => {
    const result = evaluateAuditGate(
      findings,
      register([
        {
          id: 'https://github.com/advisories/GHSA-xxxx',
          package: 'left-pad',
          reason: 'x',
          reachability: 'x',
          expires: '2026-01-01',
        },
      ]),
      today,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('expired');
  });

  it('fails an unused exception so the register cannot rot', () => {
    const result = evaluateAuditGate(
      [],
      register([
        {
          id: 'GHSA-unused',
          package: 'ghost',
          reason: 'x',
          reachability: 'x',
          expires: '2099-01-01',
        },
      ]),
      today,
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toContain('matches no current advisory');
  });

  it('passes a clean tree with an empty register', () => {
    expect(evaluateAuditGate([], register([]), today).ok).toBe(true);
  });
});
