/**
 * Which pre-release dist-tag of a package is worth watching today: one of the usual channels
 * whose version is above `latest`, and of those the one published last. A tag below `latest`
 * (a canary of a version already released) or a channel that stopped (Payload's canary once its
 * betas began) would test the past, and internal or branch tags are not channels at all.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The dist-tags a project uses for what comes next; anything else (`internal`, `next--wasm`) is not one. */
export const CHANNELS: readonly string[] = ['alpha', 'beta', 'rc', 'canary', 'next'];

const VERSION =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u;

function identifierOrder(left: string, right: string): number {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Semver precedence, pre-release identifiers included; undefined when either side is no version. */
export function compareVersions(left: string, right: string): number | undefined {
  const a = VERSION.exec(left);
  const b = VERSION.exec(right);
  if (a === null || b === null) return undefined;
  for (let index = 1; index <= 3; index++) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference;
  }
  const leftPre = a[4]?.split('.') ?? [];
  const rightPre = b[4]?.split('.') ?? [];
  if (leftPre.length === 0 || rightPre.length === 0) return rightPre.length - leftPre.length;
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index++) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const order = identifierOrder(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

export interface Channel {
  readonly tag: string;
  readonly version: string;
}

export function chooseChannel(
  distTags: Readonly<Record<string, string>>,
  time: Readonly<Record<string, string>>,
): Channel | undefined {
  const latest = distTags['latest'];
  if (latest === undefined) return undefined;
  return CHANNELS.flatMap((tag) => {
    const version = distTags[tag];
    return version !== undefined && (compareVersions(version, latest) ?? 0) > 0
      ? [{ tag, version, published: time[version] ?? '' }]
      : [];
  })
    .sort((left, right) => (left.published < right.published ? 1 : -1))
    .map(({ tag, version }) => ({ tag, version }))[0];
}

/** `npm view` answers one object for one version and an array when it lists several. */
function registry(name: string): {
  distTags: Record<string, string>;
  time: Record<string, string>;
} {
  const raw = JSON.parse(
    execFileSync('npm', ['view', name, 'dist-tags', 'time', '--json'], { encoding: 'utf8' }),
  ) as unknown;
  const record = (Array.isArray(raw) ? raw[0] : raw) as {
    'dist-tags'?: Record<string, string>;
    time?: Record<string, string>;
  };
  return { distTags: record['dist-tags'] ?? {}, time: record.time ?? {} };
}

/**
 * `node scripts/prerelease-channel.ts <package> <latest|prerelease>`: prints the tag to install,
 * and hands `tag` and `version` to the next steps through GITHUB_OUTPUT. No channel above
 * `latest` leaves both empty, which the workflow reads as "nothing to watch today". `install`
 * is the tag or, without one, `latest`, for a step that installs this package beside another
 * one's channel.
 */
function main(): void {
  const [name, lane] = process.argv.slice(2);
  if (name === undefined || (lane !== 'latest' && lane !== 'prerelease')) {
    throw new Error('usage: prerelease-channel.ts <package> <latest|prerelease>');
  }
  const { distTags, time } = registry(name);
  const chosen =
    lane === 'latest'
      ? distTags['latest'] === undefined
        ? undefined
        : { tag: 'latest', version: distTags['latest'] }
      : chooseChannel(distTags, time);
  process.stdout.write(
    chosen === undefined
      ? `${name}: no ${lane} channel above latest ${distTags['latest'] ?? '(none)'}\n`
      : `${name}: ${chosen.tag} = ${chosen.version}\n`,
  );
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined) {
    appendFileSync(
      output,
      `tag=${chosen?.tag ?? ''}\nversion=${chosen?.version ?? ''}\ninstall=${chosen?.tag ?? 'latest'}\n`,
    );
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) main();
