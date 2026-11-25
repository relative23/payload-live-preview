import { describe, expect, it, vi } from 'vitest';
import { fullMutation } from '../../../scripts/mutation-plan';
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
