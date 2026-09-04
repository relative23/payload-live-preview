import { describe, expect, it } from 'vitest';
import {
  changelogSection,
  planGithubRelease,
  publishGithubRelease,
  remoteTagCommit,
} from '../../scripts/github-release';
import type { CommandResult } from '../../scripts/release-gate';

const TESTED = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const CHANGELOG = [
  '# pkg',
  '',
  '## 2.0.0',
  '',
  '### Major Changes',
  '',
  '- abc: the change',
  '',
  '## 1.9.0',
  '',
  '- older',
].join('\n');

const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
const failed = (stderr: string): CommandResult => ({ status: 1, stdout: '', stderr });

function world(state: { local?: string; remote?: string; release?: boolean; pushFails?: boolean }) {
  const commands: string[] = [];
  const run = (executable: string, args: readonly string[]): CommandResult => {
    const command = `${executable} ${args.join(' ')}`;
    commands.push(command);
    if (command.startsWith('git rev-parse')) {
      return state.local === undefined ? failed('missing') : ok(`${state.local}\n`);
    }
    if (command.startsWith('git ls-remote')) {
      return ok(
        state.remote === undefined
          ? ''
          : `${OTHER}\trefs/tags/v2.0.0\n${state.remote}\trefs/tags/v2.0.0^{}\n`,
      );
    }
    if (command.startsWith('git push')) return state.pushFails === true ? failed('rejected') : ok();
    if (command.startsWith('gh api')) {
      return state.release === true ? ok('v2.0.0\n') : failed('HTTP 404');
    }
    if (command.startsWith('gh release create')) return ok();
    throw new Error(`unexpected ${command}`);
  };
  return { commands, run };
}

describe('release notes', () => {
  it('extracts exactly the section for the version', () => {
    expect(changelogSection(CHANGELOG, '2.0.0')).toBe('### Major Changes\n\n- abc: the change\n');
    expect(changelogSection(CHANGELOG, '1.9.0')).toBe('- older\n');
    expect(() => changelogSection(CHANGELOG, '3.0.0')).toThrow(/no "## 3.0.0" section/u);
  });

  it('prefers the peeled commit of an annotated remote tag', () => {
    expect(remoteTagCommit(`${OTHER}\trefs/tags/v1\n${TESTED}\trefs/tags/v1^{}\n`)).toBe(TESTED);
    expect(remoteTagCommit(`${TESTED}\trefs/tags/v1\n`)).toBe(TESTED);
    expect(remoteTagCommit('')).toBeUndefined();
  });
});

describe('release plan', () => {
  it('pushes a fresh tag and creates the release', () => {
    expect(
      planGithubRelease(
        { localTagSha: TESTED, remoteTagSha: undefined, releaseExists: false },
        TESTED,
        'v2.0.0',
      ),
    ).toEqual({
      pushTag: true,
      createRelease: true,
    });
  });

  it('reconciles a pushed tag without a release and a complete release as a no-op', () => {
    expect(
      planGithubRelease(
        { localTagSha: TESTED, remoteTagSha: TESTED, releaseExists: false },
        TESTED,
        'v2.0.0',
      ),
    ).toEqual({
      pushTag: false,
      createRelease: true,
    });
    expect(
      planGithubRelease(
        { localTagSha: TESTED, remoteTagSha: TESTED, releaseExists: true },
        TESTED,
        'v2.0.0',
      ),
    ).toEqual({
      pushTag: false,
      createRelease: false,
    });
  });

  it('refuses tags that do not point at the tested commit', () => {
    expect(() =>
      planGithubRelease(
        { localTagSha: undefined, remoteTagSha: undefined, releaseExists: false },
        TESTED,
        'v2.0.0',
      ),
    ).toThrow(/does not exist locally/u);
    expect(() =>
      planGithubRelease(
        { localTagSha: OTHER, remoteTagSha: undefined, releaseExists: false },
        TESTED,
        'v2.0.0',
      ),
    ).toThrow(/points to/u);
    expect(() =>
      planGithubRelease(
        { localTagSha: TESTED, remoteTagSha: OTHER, releaseExists: false },
        TESTED,
        'v2.0.0',
      ),
    ).toThrow(/origin already has/u);
  });
});

describe('publishing the GitHub release', () => {
  it('pushes the tag, creates the release from the changelog, and flags prereleases', () => {
    const { commands, run } = world({ local: TESTED });
    let notes = '';
    const plan = publishGithubRelease({
      repository: 'o/r',
      version: '2.0.0',
      testedSha: TESTED,
      changelog: CHANGELOG,
      run,
      writeNotes: (body) => {
        notes = body;
        return '/tmp/notes.md';
      },
    });
    expect(plan).toEqual({ pushTag: true, createRelease: true });
    expect(notes).toBe('### Major Changes\n\n- abc: the change\n');
    expect(commands.filter((command) => command.startsWith('git push'))).toEqual([
      'git push origin refs/tags/v2.0.0',
    ]);
    expect(commands.at(-1)).toBe(
      'gh release create v2.0.0 --verify-tag --title v2.0.0 --notes-file /tmp/notes.md',
    );

    const prerelease = world({ local: TESTED });
    publishGithubRelease({
      repository: 'o/r',
      version: '2.0.0-beta.1',
      testedSha: TESTED,
      changelog: CHANGELOG.replaceAll('2.0.0', '2.0.0-beta.1'),
      run: prerelease.run,
      writeNotes: () => '/tmp/notes.md',
    });
    expect(prerelease.commands.at(-1)).toContain('--prerelease');
  });

  it('does nothing when the tag is on origin and the release exists', () => {
    const { commands, run } = world({ local: TESTED, remote: TESTED, release: true });
    expect(
      publishGithubRelease({
        repository: 'o/r',
        version: '2.0.0',
        testedSha: TESTED,
        changelog: CHANGELOG,
        run,
        writeNotes: () => '',
      }),
    ).toEqual({
      pushTag: false,
      createRelease: false,
    });
    expect(
      commands.some(
        (command) => command.startsWith('git push') || command.startsWith('gh release'),
      ),
    ).toBe(false);
  });

  it('surfaces a rejected tag push', () => {
    const { run } = world({ local: TESTED, pushFails: true });
    expect(() =>
      publishGithubRelease({
        repository: 'o/r',
        version: '2.0.0',
        testedSha: TESTED,
        changelog: CHANGELOG,
        run,
        writeNotes: () => '',
      }),
    ).toThrow(/pushing v2.0.0 failed/u);
  });
});
