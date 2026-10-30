/**
 * Turn a drift report into a GitHub issue.
 *
 * `check-protocol-drift.ts` runs nightly and fails when the published Payload
 * client stops behaving the way this package's hand-mirrored protocol expects.
 * A red scheduled run is easy to miss — nobody watches a cron job — so the same
 * finding is filed as an issue, and updated rather than duplicated while it is
 * still open (`scripts/github-issue.mjs`). The watch jobs run published code with
 * read-only permissions and leave their results as artifacts; the report job reads
 * them with plain `node` and is the only one that may write the issue.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DriftReport } from './check-protocol-drift';
import { fileIssue } from './github-issue.mjs';

/** The file `check-protocol-drift.ts` writes on drift, which the wire job uploads as it is. */
const REPORT_FILE = 'protocol-drift.json';
const LABEL = 'protocol-drift';
const TITLE = 'Protocol drift: @payloadcms/live-preview no longer matches this runtime';

export function issueBody(report: DriftReport): string {
  const lines = [
    `The nightly protocol watch executed \`${report.package}\` at ${report.checkedAt} and found`,
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
    '- `tests/fixtures/protocol-model.ts` — what each field on the wire means',
    '',
    'Filed by `scripts/report-protocol-drift.ts` from the Protocol Watch workflow.',
  ];
  return lines.join('\n');
}

/** A cell that cannot break the table, however the assertion phrased itself. */
function escapeCell(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ');
}

/**
 * The admin half of the watch never writes a drift report: it boots a real
 * admin against the published Payload and fails before any invariant runs when
 * the install or the boot goes wrong. That failure is exactly as invisible as
 * drift, so the job asks for this fallback by name — an unasked-for one would
 * turn every unrelated red step on the other job into an issue.
 */
export function fallbackReport(pkg: string, detail: string): DriftReport {
  return {
    package: pkg,
    checkedAt: new Date().toISOString(),
    failures: [{ check: 'the real admin run did not reach its assertions', detail }],
  };
}

/** What one watch job left as its artifact: how it ended, and the drift report when it wrote one. */
export interface WatchResult {
  readonly job: string;
  readonly distTag: string;
  readonly outcome: string;
  readonly report?: DriftReport;
}

export const ADMIN_FALLBACK =
  'the real admin E2E job failed before its assertions; read the run log';

export function readWatchResults(directory: string): WatchResult[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .filter((folder) => existsSync(join(folder, 'result.json')))
    .sort()
    .map((folder) => {
      const result = JSON.parse(readFileSync(join(folder, 'result.json'), 'utf8')) as WatchResult;
      const drift = join(folder, REPORT_FILE);
      return existsSync(drift)
        ? { ...result, report: JSON.parse(readFileSync(drift, 'utf8')) as DriftReport }
        : result;
    });
}

/**
 * What the report job files, on the gate entry only: drift the wire check wrote down, and the
 * admin run that failed without reaching an assertion. A red wire job with no report failed in
 * the upstream-findings step, which is news for the docs, not drift.
 */
export function reportsToFile(results: readonly WatchResult[]): DriftReport[] {
  return results
    .filter((result) => result.distTag === 'latest' && result.outcome !== 'success')
    .flatMap((result) =>
      result.report !== undefined
        ? [result.report]
        : result.job === 'admin-e2e'
          ? [fallbackReport('payload@latest', ADMIN_FALLBACK)]
          : [],
    );
}

function main(): void {
  const directory = process.argv[2] ?? 'protocol-watch';
  const reports = reportsToFile(readWatchResults(directory));
  if (reports.length === 0) console.log('[protocol-watch] nothing to report');
  for (const report of reports) file(report);
}

function file(report: DriftReport): void {
  fileIssue({
    label: LABEL,
    labelDescription: 'Payload wire-format drift',
    title: TITLE,
    body: issueBody(report),
    log: 'protocol-watch',
  });
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
