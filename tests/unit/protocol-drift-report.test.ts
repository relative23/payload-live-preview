import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADMIN_FALLBACK,
  fallbackReport,
  issueBody,
  readWatchResults,
  reportsToFile,
} from '../../scripts/report-protocol-drift';
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
    // A run that never asserted says nothing about the protocol, so it does not claim drift.
    expect(issueBody(report)).toContain('the boot never finished');
    expect(issueBody(report)).toContain('says nothing about the protocol');
    expect(issueBody(report)).not.toContain('mirrors differently');
  });
});

describe('what the report job files', () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  function artifacts(entries: Record<string, { result: unknown; report?: unknown }>): string {
    const root = mkdtempSync(join(tmpdir(), 'plp-protocol-watch-'));
    folders.push(root);
    for (const [name, { result, report }] of Object.entries(entries)) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'result.json'), JSON.stringify(result));
      if (report !== undefined) {
        writeFileSync(join(root, name, 'protocol-drift.json'), JSON.stringify(report));
      }
    }
    return root;
  }

  it('the drift the gate entry wrote down, and the admin run that never reached an assertion', () => {
    const root = artifacts({
      'protocol-watch-wire-latest': {
        result: { job: 'protocol-watch', distTag: 'latest', outcome: 'failure' },
        report: REPORT,
      },
      'protocol-watch-admin-latest': {
        result: { job: 'admin-e2e', distTag: 'latest', outcome: 'failure' },
      },
    });

    const [admin, drift] = reportsToFile(readWatchResults(root));
    expect(drift).toEqual(REPORT);
    expect(admin?.package).toBe('payload@latest');
    expect(admin?.failures).toEqual(fallbackReport('payload@latest', ADMIN_FALLBACK).failures);
  });

  it('nothing for the pre-release entries, a green run or an upstream finding without drift', () => {
    const root = artifacts({
      'protocol-watch-wire-beta': {
        result: { job: 'protocol-watch', distTag: 'beta', outcome: 'failure' },
        report: REPORT,
      },
      'protocol-watch-admin-beta': {
        result: { job: 'admin-e2e', distTag: 'beta', outcome: 'failure' },
      },
      'protocol-watch-admin-latest': {
        result: { job: 'admin-e2e', distTag: 'latest', outcome: 'success' },
      },
      'protocol-watch-wire-latest': {
        result: { job: 'protocol-watch', distTag: 'latest', outcome: 'failure' },
      },
    });

    expect(reportsToFile(readWatchResults(root))).toEqual([]);
  });
});

describe('the workflow that files it', () => {
  it('writes the issue from its report job only, and no other workflow may write one at all', () => {
    const watch = WORKFLOW_EXPECTATIONS['protocol-watch.yml'];

    expect(watch?.permissions).toEqual({ contents: 'read' });
    expect(watch?.jobs['report']?.permissions).toEqual({ contents: 'read', issues: 'write' });
    expect(
      (watch?.jobs['report']?.steps ?? []).flatMap((step) => ('run' in step ? [step.run] : [])),
    ).toEqual(['node scripts/report-protocol-drift.ts protocol-watch']);
    // Each watch writes its issues from a report job that installs nothing.
    const reporting = new Set(['protocol-watch.yml report', 'latest-watch.yml report']);
    for (const [name, spec] of Object.entries(WORKFLOW_EXPECTATIONS)) {
      if (spec.permissions !== undefined && spec.permissions !== null) {
        expect(spec.permissions, name).not.toHaveProperty('issues');
      }
      for (const [job, jobSpec] of Object.entries(spec.jobs)) {
        if (reporting.has(`${name} ${job}`)) continue;
        expect(jobSpec.permissions ?? {}, `${name} ${job}`).not.toHaveProperty('issues');
      }
    }
  });
});
