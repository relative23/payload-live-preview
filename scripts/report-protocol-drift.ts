/**
 * Turn a drift report into a GitHub issue.
 *
 * `check-protocol-drift.ts` runs weekly and fails when the published Payload
 * client stops behaving the way this package's hand-mirrored protocol expects.
 * A red scheduled run is easy to miss — nobody watches a cron job — so the same
 * finding is filed as an issue, and updated rather than duplicated while it is
 * still open.
 *
 * `gh` is used instead of a pinned action: the token is the workflow's own, the
 * two commands are auditable here, and there is one less third-party step in a
 * job that already runs published code.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DriftReport } from './check-protocol-drift';

const REPORT_PATH = process.env['PROTOCOL_WATCH_REPORT'] ?? 'protocol-drift.json';
const LABEL = 'protocol-drift';
const TITLE = 'Protocol drift: @payloadcms/live-preview no longer matches this runtime';

export function issueBody(report: DriftReport): string {
  const lines = [
    `The weekly protocol watch executed \`${report.package}\` at ${report.checkedAt} and found`,
    `${String(report.failures.length)} behaviour(s) this package mirrors differently:`,
    '',
    '| Check | What it saw |',
    '| --- | --- |',
    ...report.failures.map(
      (failure) => `| ${escapeCell(failure.check)} | \`${escapeCell(failure.detail)}\` |`,
    ),
    '',
    'This package hand-mirrors the postMessage protocol and has no `payload`',
    'dependency, so drift is silent for consumers until something stops updating.',
    'Review against the new client:',
    '',
    '- `src/core/message-bus.ts` — the handshake and the message discriminators',
    '- `src/core/data-merger.ts` — the REST merge request',
    '- `src/types/payload-protocol.ts` — the shapes both of them read',
    '',
    'Filed by `scripts/report-protocol-drift.ts` from the Protocol Watch workflow.',
  ];
  return lines.join('\n');
}

/** A cell that cannot break the table, however the assertion phrased itself. */
function escapeCell(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

function gh(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8' }).trim();
}

function openIssueNumber(): string | undefined {
  const found = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    LABEL,
    '--limit',
    '1',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  return found.length > 0 ? found : undefined;
}

function main(): void {
  if (!existsSync(REPORT_PATH)) {
    console.log(`[protocol-watch] no ${REPORT_PATH}; nothing to report`);
    return;
  }
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as DriftReport;
  const body = issueBody(report);
  const existing = openIssueNumber();
  if (existing === undefined) {
    // The label is created on demand: a fresh checkout of this repository has
    // no labels, and a missing one would fail the create.
    try {
      gh(['label', 'create', LABEL, '--description', 'Payload wire-format drift', '--force']);
    } catch {
      // A repository where labels cannot be written still gets the issue.
    }
    const url = gh(['issue', 'create', '--title', TITLE, '--body', body, '--label', LABEL]);
    console.log(`[protocol-watch] filed ${url}`);
    return;
  }
  gh(['issue', 'comment', existing, '--body', body]);
  console.log(`[protocol-watch] updated issue #${existing}`);
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
