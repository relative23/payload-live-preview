/**
 * File each integration the latest watch saw fail as an issue of its own. The watch jobs
 * install published code with read-only permissions and leave one result folder each; the
 * report job installs nothing, runs this file with plain `node`, and alone may write issues.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileIssue } from './github-issue.mjs';

export interface LatestResult {
  /** The matrix entry, e.g. `nuxt` or `hooks`. */
  readonly integration: string;
  /** The job's status when its last step ran: `success`, `failure` or `cancelled`. */
  readonly outcome: string;
  /** What `npm ls --json --depth=0` resolved, by package name. */
  readonly versions: Readonly<Record<string, string>>;
}

/** One folder per downloaded artifact, each with `result.json` and, when npm got that far, `npm-ls.json`. */
export function readResults(directory: string): LatestResult[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(directory, entry.name))
    .filter((folder) => existsSync(join(folder, 'result.json')))
    .sort()
    .map((folder) => {
      const result = JSON.parse(readFileSync(join(folder, 'result.json'), 'utf8')) as {
        integration: string;
        outcome: string;
      };
      return {
        integration: result.integration,
        outcome: result.outcome,
        versions: versionsIn(folder),
      };
    });
}

/** `npm ls` exits non-zero on an invalid tree and may write nothing; an unreadable file names no version. */
function versionsIn(folder: string): Record<string, string> {
  const path = join(folder, 'npm-ls.json');
  if (!existsSync(path)) return {};
  try {
    const tree = JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies?: Record<string, { version?: string }>;
    };
    return Object.fromEntries(
      Object.entries(tree.dependencies ?? {}).flatMap(([name, dependency]) =>
        dependency.version === undefined ? [] : [[name, dependency.version]],
      ),
    );
  } catch {
    return {};
  }
}

export function issueTitle(integration: string): string {
  return `Latest watch: the latest ${integration} release fails against this package`;
}

export function issueBody(result: LatestResult, run: string): string {
  const versions = Object.entries(result.versions);
  return [
    `The daily latest watch installed the latest \`${result.integration}\` packages over its`,
    `fixture without a lockfile, and the job ended \`${result.outcome}\`: ${run}`,
    '',
    ...(versions.length === 0
      ? ['The install did not get far enough to list what it resolved.']
      : [
          '| Package | Installed |',
          '| --- | --- |',
          ...versions.map(([name, version]) => `| \`${name}\` | ${version} |`),
        ]),
    '',
    'CI installs exact lockfiles, so a release of these packages shows up here first. The run',
    `log names the failing step; \`latest-watch-${result.integration}\` holds the full \`npm ls\`.`,
    '',
    'Filed by `scripts/report-latest-watch.ts` from the Latest Watch workflow.',
  ].join('\n');
}

function main(): void {
  const directory = process.argv[2] ?? 'latest-watch';
  const run = process.env['PLP_LATEST_WATCH_RUN'] ?? 'see the Latest Watch run';
  const results = readResults(directory);
  if (results.length === 0) {
    // Every watch job uploads its result whatever happens; none at all means the download broke.
    throw new Error(`latest-watch: no results under ${directory}`);
  }
  for (const result of results) {
    if (result.outcome === 'success') continue;
    fileIssue({
      label: `latest-watch-${result.integration}`,
      labelDescription: `The latest ${result.integration} release fails`,
      title: issueTitle(result.integration),
      body: issueBody(result, run),
      log: 'latest-watch',
    });
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
