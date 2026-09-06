/**
 * Like for like: how much code this package spends on the job
 * `@payloadcms/live-preview` also does, measured rather than quoted.
 *
 * "21 884 against 488 lines" compares a DOM runtime plus a toolchain with a
 * merge helper, and a number that unfair is a number nobody can use. This
 * measures the same job on both sides — the handshake, the origin decision, the
 * REST merge, the protocol shapes, and (for their React wrapper) the document
 * session a hook subscribes to.
 *
 * Their source is recovered from the `sourcesContent` of the source maps they
 * ship, so both sides are authored TypeScript and neither is a build artifact.
 * Run it: `npx tsx scripts/compare-scope.ts`.
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const THEIR_DIST = resolve(ROOT, 'node_modules/@payloadcms/live-preview/dist');

/**
 * Our code lines in the comparable scope, as reviewed. It is here rather than
 * in `quality/complexity-budget.json` because one number belongs with the
 * measurement that produces it; a change means this line moves and someone
 * says why in the commit.
 *
 * 795 for the protocol and the merge (theirs: 185), 149 for the hook session
 * (their React wrapper is a separate package and not measured here).
 */
export const REVIEWED_SCOPE_LINES = 944;

interface OurFile {
  readonly file: string;
  /** The part of the job this file does, in the words the report uses. */
  readonly does: string;
}

interface ScopeGroup {
  readonly title: string;
  readonly ours: readonly OurFile[];
  /** Their counterpart, when it is installed and can be measured. */
  readonly theirs?: 'base-package';
  readonly note?: string;
}

const GROUPS: readonly ScopeGroup[] = [
  {
    title: 'Protocol, origin and merge',
    theirs: 'base-package',
    ours: [
      { file: 'src/core/message-bus.ts', does: 'ingress: origin, source, shape, token queue' },
      { file: 'src/core/message-guards.ts', does: 'per-type shape guards' },
      { file: 'src/core/data-merger.ts', does: 'the REST merge, with abort and ordering' },
      { file: 'src/detection/origin.ts', does: 'which origins are trusted, and locking' },
      { file: 'src/types/payload-protocol.ts', does: 'the wire shapes both sides read' },
    ],
  },
  {
    title: 'Document session behind a hook',
    note: 'their `@payloadcms/live-preview-react` wrapper is a separate package, not installed here',
    ours: [
      {
        file: 'src/adapters/shared/document-session.ts',
        does: 'the snapshot a hook or composable subscribes to',
      },
    ],
  },
];

export interface LineCount {
  readonly total: number;
  readonly code: number;
}

/** Blank lines and comment-only lines are not what a reader has to follow. */
export function countLines(source: string): LineCount {
  const lines = source.split('\n');
  return {
    total: lines.length,
    code: lines.filter((line) => !/^\s*(?:\/\/|\/\*|\*|$)/u.test(line)).length,
  };
}

function add(left: LineCount, right: LineCount): LineCount {
  return { total: left.total + right.total, code: left.code + right.code };
}

const EMPTY: LineCount = { total: 0, code: 0 };

export interface ScopeMeasurement {
  readonly ours: LineCount;
  readonly theirs: LineCount;
  readonly theirFiles: number;
  readonly groups: readonly { readonly title: string; readonly ours: LineCount }[];
}

/**
 * Their authored source, from the maps they publish. Reading `dist/*.js` would
 * measure a compiler's line breaks instead of anyone's code.
 */
export async function measureTheirSource(): Promise<{ lines: LineCount; files: number }> {
  let lines = EMPTY;
  let files = 0;
  for (const name of (await readdir(THEIR_DIST)).sort()) {
    if (!name.endsWith('.js.map')) continue;
    const map = JSON.parse(await readFile(resolve(THEIR_DIST, name), 'utf8')) as {
      sourcesContent?: readonly string[];
    };
    const content = map.sourcesContent?.[0];
    if (content === undefined) continue;
    files += 1;
    lines = add(lines, countLines(content));
  }
  return { lines, files };
}

export async function measureScope(): Promise<ScopeMeasurement> {
  const groups: { title: string; ours: LineCount }[] = [];
  let ours = EMPTY;
  for (const group of GROUPS) {
    let groupLines = EMPTY;
    for (const entry of group.ours) {
      groupLines = add(groupLines, countLines(await readFile(resolve(ROOT, entry.file), 'utf8')));
    }
    groups.push({ title: group.title, ours: groupLines });
    ours = add(ours, groupLines);
  }
  const theirs = await measureTheirSource();
  return { ours, theirs: theirs.lines, theirFiles: theirs.files, groups };
}

function format(measurement: ScopeMeasurement): string {
  const ratio = (measurement.ours.code / Math.max(measurement.theirs.code, 1)).toFixed(1);
  const rows = [
    'scope                              ours (total/code)   theirs (total/code)',
    ...GROUPS.map((group, index) => {
      const ours = measurement.groups[index]?.ours ?? EMPTY;
      const theirs =
        group.theirs === 'base-package'
          ? `${String(measurement.theirs.total)}/${String(measurement.theirs.code)}`
          : '— not installed';
      return `${group.title.padEnd(34)} ${`${String(ours.total)}/${String(ours.code)}`.padEnd(19)} ${theirs}`;
    }),
    '',
    `ours ${String(measurement.ours.code)} code lines against their ${String(measurement.theirs.code)} — ${ratio}×, ` +
      `across ${String(measurement.theirFiles)} of their files.`,
    'What the difference implements: abort and ordering on the merge, the token',
    'queue in arrival order, the source policy, per-type shape guards, origin',
    'locking, the locale index, and owner scoping. Each of those is a measured',
    'failure of the smaller version (see the comparison report, section 5).',
  ];
  return `${rows.join('\n')}\n`;
}

async function main(): Promise<void> {
  const measurement = await measureScope();
  process.stdout.write(format(measurement));
  if (!process.argv.includes('--check')) return;
  if (measurement.ours.code !== REVIEWED_SCOPE_LINES) {
    throw new Error(
      `comparable scope moved: ${String(measurement.ours.code)} code lines against the reviewed ` +
        `${String(REVIEWED_SCOPE_LINES)}. Update REVIEWED_SCOPE_LINES in this file and say why — ` +
        'this is the number the comparison report quotes.',
    );
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
