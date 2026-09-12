import { describe, expect, it } from 'vitest';
import { fallbackReport, issueBody } from '../../scripts/report-protocol-drift';
import { WORKFLOW_EXPECTATIONS } from '../../scripts/workflow-expectations';

/**
 * The weekly watch is the only gate nobody looks at: a red cron run is invisible
 * until someone happens to open the Actions tab. The issue it files is the
 * finding's only path to a person, so what that issue says is worth a test.
 */

const REPORT = {
  package: '@payloadcms/live-preview@latest',
  checkedAt: '2026-09-06T06:00:00.000Z',
  failures: [
    { check: 'mergeData sends X-Payload-HTTP-Method-Override: GET', detail: '{"accept":"*/*"}' },
    { check: 'ready() posts to the parent', detail: 'no postMessage observed' },
  ],
} as const;

describe('the drift issue', () => {
  it('names every failed check and what it saw', () => {
    const body = issueBody(REPORT);

    for (const failure of REPORT.failures) {
      expect(body).toContain(failure.check);
      expect(body).toContain(failure.detail);
    }
    expect(body).toContain('@payloadcms/live-preview@latest');
    expect(body).toContain('2026-09-06T06:00:00.000Z');
  });

  it('points at the three files that mirror the protocol', () => {
    // Whoever picks the issue up should not have to search for where the
    // hand-mirrored format lives.
    const body = issueBody(REPORT);

    expect(body).toContain('src/core/message-bus.ts');
    expect(body).toContain('src/core/data-merger.ts');
    expect(body).toContain('src/types/payload-protocol.ts');
  });

  it('keeps a pipe in an assertion from breaking the table', () => {
    const body = issueBody({
      ...REPORT,
      failures: [{ check: 'a | b', detail: 'saw\ntwo | lines' }],
    });

    const row = body.split('\n').find((line) => line.includes('a \\| b'));
    expect(row).toBeDefined();
    // Two escaped pipes plus the three that build the row: the table survives.
    expect(row).toContain('two \\| lines');
    expect(row).not.toContain('\n');
  });
});

describe('the fallback the admin half asks for', () => {
  it('names the package and what went wrong, and only when asked', () => {
    const report = fallbackReport('payload@latest', 'the boot never finished');

    expect(report.package).toBe('payload@latest');
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.detail).toBe('the boot never finished');
    // The body is the same one a drift report produces, so whoever picks the
    // issue up lands on the same three files.
    expect(issueBody(report)).toContain('src/core/message-bus.ts');
  });

  it('is wired into the admin job on the gate entry only', () => {
    const watch = WORKFLOW_EXPECTATIONS['protocol-watch.yml'];
    const steps = watch?.jobs['admin-e2e']?.steps ?? [];
    const step = steps
      .filter((candidate) => 'run' in candidate)
      .find((candidate) => candidate.run.includes('report-protocol-drift'));

    expect(step?.condition).toBe("failure() && matrix.dist-tag == 'latest'");
    expect(step?.env?.['PROTOCOL_WATCH_FALLBACK']).toBeDefined();
  });
});

describe('the workflow that files it', () => {
  it('is the only one allowed to write an issue, and only on the gate entry', () => {
    const watch = WORKFLOW_EXPECTATIONS['protocol-watch.yml'];
    const step = watch?.jobs['protocol-watch']?.steps?.find(
      (candidate) => 'run' in candidate && candidate.run.includes('report-protocol-drift'),
    );

    expect(watch?.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(step?.condition).toBe("failure() && matrix.dist-tag == 'latest'");
    for (const [name, spec] of Object.entries(WORKFLOW_EXPECTATIONS)) {
      if (name === 'protocol-watch.yml') continue;
      // A workflow without a reviewed `permissions` block inherits the
      // repository default, which is not this file's business; one that has
      // it must not ask for issues.
      if (spec.permissions === undefined || spec.permissions === null) continue;
      expect(spec.permissions, name).not.toHaveProperty('issues');
    }
  });
});
