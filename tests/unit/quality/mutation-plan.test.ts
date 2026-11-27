import { describe, expect, it, vi } from 'vitest';
import {
  changedSince,
  coreMutation,
  corePaths,
  fullMutation,
} from '../../../scripts/mutation-plan';
import type { CommandResult } from '../../../scripts/release-gate';

const answer = (status: number, stdout: string, stderr = ''): (() => CommandResult) =>
  vi.fn(() => ({ status, stdout, stderr }));

/**
 * The complete mutation scope runs every night and for a commit whose version is not on npm yet.
 * One answer alone leaves it out: the registry serves exactly this version (ADR 0013, section 13).
 */
describe('the mutation plan of the critical gates', () => {
  it('mutates the complete scope always when the caller says so, without asking the registry', () => {
    const lookup = answer(0, '3.0.0\n');

    expect(fullMutation('always', '3.0.0', lookup)).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('leaves it out for a version the registry serves', () => {
    expect(fullMutation('unpublished-version', '2.5.0', answer(0, '2.5.0\n'))).toBe(false);
  });

  it('mutates it for a version the registry does not know', () => {
    const notFound = answer(1, '', 'npm error code E404\nnpm error 404 No match found');

    expect(fullMutation('unpublished-version', '3.0.0-rc.0', notFound)).toBe(true);
  });

  it('mutates it when the registry answers with nothing or with another version', () => {
    expect(fullMutation('unpublished-version', '3.0.0', answer(0, ''))).toBe(true);
    expect(fullMutation('unpublished-version', '3.0.0', answer(0, '2.5.0\n'))).toBe(true);
  });

  it('mutates it when the registry cannot be asked', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const outage = answer(1, '', 'npm error code ETIMEDOUT');
    const noNpm = (): CommandResult => {
      throw new Error('spawnSync npm ENOENT');
    };

    expect(fullMutation('unpublished-version', '2.5.0', outage)).toBe(true);
    expect(fullMutation('unpublished-version', '2.5.0', noNpm)).toBe(true);
    expect(errors.mock.calls.map(([message]) => String(message).split('\n')[0])).toEqual([
      'npm registry lookup failed; refusing to infer an unpublished version:',
      'spawnSync npm ENOENT',
    ]);
    errors.mockRestore();
  });

  it('refuses a mode it does not know', () => {
    const lookup = answer(0, '3.0.0\n');

    expect(() => fullMutation('sometimes', '3.0.0', lookup)).toThrow(
      'Unknown mutation mode "sometimes"; expected "always" or "unpublished-version"',
    );
    expect(() => fullMutation(undefined, '3.0.0', lookup)).toThrow(
      'Unknown mutation mode "undefined"; expected "always" or "unpublished-version"',
    );
    expect(lookup).not.toHaveBeenCalled();
  });
});

/**
 * The trusted core is mutated with the complete scope, and at once for a push that changes what
 * its score is measured on. A push whose range cannot be read counts as one that does (ADR 0013,
 * section 14).
 */
describe('when the trusted core is mutated', () => {
  const PATHS = ['src/security/escape.ts', 'quality/mutation-policy-core.json'];
  const BASE = '2d7c2b66d0a1f0c6b5d1b2d7f9c8e7a6b5c4d3e2';
  const git = (answers: Record<string, CommandResult>) => {
    const calls: string[] = [];
    const run = (args: readonly string[]): CommandResult => {
      calls.push(args.join(' '));
      return answers[args[0] ?? ''] ?? { status: 1, stdout: '', stderr: 'unexpected' };
    };
    return { run, calls };
  };
  const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '' });
  const failed: CommandResult = { status: 128, stdout: '', stderr: 'fatal: bad object' };

  it('names the modules of the core, their list, their policy and how Stryker runs', () => {
    expect(
      corePaths({ core: { modules: { 'src/security/escape.ts': {}, 'src/a.ts': {} } } }),
    ).toEqual([
      'src/security/escape.ts',
      'src/a.ts',
      'quality/trusted-core.json',
      'quality/mutation-policy-core.json',
      'stryker.config.js',
      'vitest.stryker.config.ts',
    ]);
  });

  it('is mutated whenever the complete scope is, whatever the push changed', () => {
    expect(coreMutation(true, [], PATHS)).toBe(true);
    expect(coreMutation(true, undefined, PATHS)).toBe(true);
  });

  it('is mutated for a push that changes one of its paths, and left out for one that changes none', () => {
    expect(coreMutation(false, ['docs/audit.md', 'src/security/escape.ts'], PATHS)).toBe(true);
    expect(coreMutation(false, ['quality/mutation-policy-core.json'], PATHS)).toBe(true);
    expect(coreMutation(false, ['src/core/session/lifecycle.ts', 'docs/audit.md'], PATHS)).toBe(
      false,
    );
    expect(coreMutation(false, [], PATHS)).toBe(false);
  });

  it('is mutated when what the push changed is not known', () => {
    expect(coreMutation(false, undefined, PATHS)).toBe(true);
  });

  it('reads the changed files of the pushed range, a moved file under both names', () => {
    const { run, calls } = git({ 'cat-file': ok(), diff: ok('src/a.ts\ndocs/b.md\n') });

    expect(changedSince(BASE, run)).toEqual(['src/a.ts', 'docs/b.md']);
    expect(calls).toEqual([
      `cat-file -e ${BASE}^{commit}`,
      `diff --name-only --no-renames ${BASE} HEAD`,
    ]);
  });

  it('fetches the commit the push started from when the checkout does not hold it', () => {
    const { run, calls } = git({ 'cat-file': failed, fetch: ok(), diff: ok('src/a.ts\n') });

    expect(changedSince(BASE, run)).toEqual(['src/a.ts']);
    expect(calls[1]).toBe(`fetch --no-tags --depth=1 origin ${BASE}`);
  });

  it('does not know the range of a first push, of a run without one, or when git fails', () => {
    const never = git({});

    expect(changedSince(undefined, never.run)).toBeUndefined();
    expect(changedSince('', never.run)).toBeUndefined();
    expect(changedSince('0'.repeat(40), never.run)).toBeUndefined();
    expect(changedSince('main; rm -rf .', never.run)).toBeUndefined();
    expect(never.calls).toEqual([]);
    expect(changedSince(BASE, git({ 'cat-file': failed, fetch: failed }).run)).toBeUndefined();
    expect(changedSince(BASE, git({ 'cat-file': ok(), diff: failed }).run)).toBeUndefined();
  });
});
