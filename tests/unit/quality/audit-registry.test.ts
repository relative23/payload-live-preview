/**
 * A temporary exception expires when a compatible stable release appears.
 * Registry transport failures and duplicate source declarations remain errors,
 * including when npm would otherwise return a clean-looking body.
 */
import type * as ChildProcess from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const child = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>();
  return {
    ...original,
    spawnSync: child.spawnSync,
    default: { ...original, spawnSync: child.spawnSync },
  };
});
import {
  parseUniqueJson,
  validateNoFixVersions,
  verifyNoFixTrack,
} from '../../../scripts/audit-registry.mjs';

describe('NoFix registry freshness', () => {
  beforeEach(() => child.spawnSync.mockReset());
  it('accepts the reviewed track and leaves other majors and prereleases for separate review', () => {
    expect(() =>
      validateNoFixVersions(['3.0.0', '3.0.3', '3.0.4-rc.0', '4.0.0'], '3.0.3'),
    ).not.toThrow();
  });
  it.each([
    { versions: ['3.0.3', '3.0.4'] },
    { versions: ['3.0.3', '3.1.0'] },
    { versions: ['3.0.3', '3.0.3+build'] },
    { versions: [] },
    { versions: ['3.0.2'] },
    { versions: ['3.0.3', 'not semver'] },
    { versions: ['3.0.3', '3.0.4-01'] },
    { versions: ['3.0.3', '3.0.4-rc..0'] },
    { versions: ['3.0.3', '3.0.4+build..x'] },
    { versions: ['3.0.3', '3.9007199254740992.0'] },
  ])('requires new triage for a changed or malformed track: $versions', ({ versions }) => {
    expect(() => validateNoFixVersions(versions, '3.0.3')).toThrow();
  });
  it.each([{ versions: null }, { versions: {} }, { versions: '3.0.3' }, { versions: [null] }])(
    'refuses an unexpected registry shape: $versions',
    ({ versions }) => {
      expect(() => validateNoFixVersions(versions, '3.0.3')).toThrow();
    },
  );
  it('uses the official online registry with a finite non-ignorable kill signal', () => {
    child.spawnSync.mockReturnValue({ status: 0, signal: null, stdout: '["3.0.3"]' });
    expect(() => verifyNoFixTrack('braces', '3.0.3')).not.toThrow();
    expect(child.spawnSync).toHaveBeenCalledWith(
      'npm',
      expect.arrayContaining([
        '--registry=https://registry.npmjs.org',
        '--offline=false',
        '--prefer-online',
      ]),
      expect.objectContaining({ timeout: 15_000, killSignal: 'SIGKILL' }),
    );
  });
  it.each([
    { status: 1, signal: null, stdout: '["3.0.3"]' },
    { status: null, signal: 'SIGKILL', stdout: '["3.0.3"]' },
    { status: 0, signal: null, error: new Error('EAI_AGAIN'), stdout: '["3.0.3"]' },
    { status: 0, signal: null, stdout: 'not JSON' },
    { status: 0, signal: null, stdout: '{}' },
  ])('rejects a failed registry query: %j', (response) => {
    child.spawnSync.mockReturnValue(response);
    expect(() => verifyNoFixTrack('braces', '3.0.3')).toThrow();
  });
});

describe('duplicate JSON declarations', () => {
  it('keeps quoted punctuation and nested arrays intact', () => {
    expect(parseUniqueJson(String.raw`{"a":"{\"a\":1,}","b":[{"a":1},{"a":2}]}`)).toEqual({
      a: '{"a":1,}',
      b: [{ a: 1 }, { a: 2 }],
    });
  });
  it.each([
    '{"projects":{".":{},".":{}}}',
    '{"projects":{".":{},"\\u002e":{}}}',
    '{"value":[{"id":"first","id":"second"}]}',
  ])('rejects duplicate keys without losing a declaration: %s', (text) => {
    expect(() => parseUniqueJson(text)).toThrow('duplicate JSON key');
  });
});
