/**
 * File a scheduled workflow's finding as a GitHub issue, or comment on the open one with its
 * label. A red cron run is easy to miss; an issue is where a person looks. `gh` is used instead
 * of a pinned action: the token is the workflow's own and the commands are auditable here.
 */

import { execFileSync } from 'node:child_process';

/** @param {readonly string[]} args */
function gh(args) {
  return execFileSync('gh', [...args], { encoding: 'utf8' }).trim();
}

/**
 * @param {{ label: string; labelDescription: string; title: string; body: string; log: string }} issue
 * @returns {void}
 */
export function fileIssue({ label, labelDescription, title, body, log }) {
  const existing = gh([
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    label,
    '--limit',
    '1',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  if (existing.length === 0) {
    // The label is created on demand: a fresh checkout of this repository has
    // no labels, and a missing one would fail the create.
    try {
      gh(['label', 'create', label, '--description', labelDescription, '--force']);
    } catch {
      // A repository where labels cannot be written still gets the issue.
    }
    const url = gh(['issue', 'create', '--title', title, '--body', body, '--label', label]);
    process.stdout.write(`[${log}] filed ${url}\n`);
    return;
  }
  gh(['issue', 'comment', existing, '--body', body]);
  process.stdout.write(`[${log}] updated issue #${existing}\n`);
}
