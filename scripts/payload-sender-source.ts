/**
 * Fetches the two files of Payload's live-preview **sender** from
 * `payloadcms/payload`, for one npm dist-tag.
 *
 * The published `@payloadcms/live-preview` package is only the receiver; the
 * object that goes on the wire is built in the admin UI, which ships compiled.
 * Reading it therefore means reading their repository. A treeless, blobless
 * fetch of a single ref is ~0.5 MB and under a second, and `git show` pulls the
 * two blobs on demand — no working tree, no sparse-checkout state to maintain.
 */

import { execFileSync } from 'node:child_process';

const REPOSITORY = 'https://github.com/payloadcms/payload.git';

/** Where the message object is built. */
export const WINDOW_PATH = 'packages/ui/src/elements/LivePreview/Window/index.tsx';
/** Where its type is declared. */
export const TYPES_PATH = 'packages/live-preview/src/types.ts';

export interface SenderChannel {
  /** The npm dist-tag whose source we want. */
  readonly distTag: string;
  /**
   * The branch to read when the published version carries no tag. Canary
   * builds are cut from a branch without tagging, so a tag lookup would fail
   * for exactly the channel that exists to warn us early.
   */
  readonly fallbackRef: string;
}

export const SENDER_CHANNELS: readonly SenderChannel[] = [
  { distTag: 'latest', fallbackRef: '3.x' },
  { distTag: 'canary', fallbackRef: 'main' },
];

export interface SenderSources {
  readonly distTag: string;
  /** The npm version the dist-tag resolves to. */
  readonly version: string;
  /** The git ref actually read — a tag when one exists, else the branch. */
  readonly ref: string;
  /** Whether `ref` is the exact published version or the branch it comes from. */
  readonly exact: boolean;
  readonly window: string;
  readonly types: string;
}

function git(workDir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', workDir, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

/** The version an npm dist-tag points at right now. */
export function resolveVersion(distTag: string): string {
  return execFileSync('npm', ['view', `@payloadcms/ui@${distTag}`, 'version'], {
    encoding: 'utf8',
  }).trim();
}

/**
 * Reads both sender files for one channel into `workDir`, which must be empty.
 *
 * The tag is preferred because it is the exact source of the published build;
 * the branch is the honest second best, and `exact` says which one was read so
 * a report never claims more precision than it has.
 */
export function readSenderSources(channel: SenderChannel, workDir: string): SenderSources {
  const version = resolveVersion(channel.distTag);
  git(workDir, ['init', '-q', '.']);
  git(workDir, ['remote', 'add', 'origin', REPOSITORY]);
  const tag = `refs/tags/v${version}`;
  const exact = git(workDir, ['ls-remote', 'origin', tag]).trim().length > 0;
  const ref = exact ? tag : channel.fallbackRef;
  git(workDir, ['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref]);
  return {
    distTag: channel.distTag,
    version,
    ref,
    exact,
    window: git(workDir, ['show', `FETCH_HEAD:${WINDOW_PATH}`]),
    types: git(workDir, ['show', `FETCH_HEAD:${TYPES_PATH}`]),
  };
}
