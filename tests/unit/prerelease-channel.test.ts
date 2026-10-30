import { describe, expect, it } from 'vitest';
import { chooseChannel, compareVersions } from '../../scripts/prerelease-channel';

/**
 * The pre-release lane installs whatever channel this picks, every day, unattended. These are
 * the registry states of 2026-10-30 that a plain "highest version" rule gets wrong.
 */

describe('version precedence', () => {
  it('orders pre-releases the way semver does', () => {
    expect(compareVersions('4.0.0-canary.39', '4.0.0-beta.6')).toBeGreaterThan(0);
    expect(compareVersions('19.3.0-canary-c5ec5c6d-20261029', '19.3.1')).toBeLessThan(0);
    expect(compareVersions('3.6.0-rc.14', '3.6.0-beta.17')).toBeGreaterThan(0);
    expect(compareVersions('3.6.0', '3.6.0-rc.14')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBeLessThan(0);
    expect(compareVersions('16.5.0-canary.34', '16.4.3')).toBeGreaterThan(0);
  });

  it('refuses what is not a version rather than ordering it', () => {
    expect(compareVersions('latest', '1.0.0')).toBeUndefined();
    expect(compareVersions('1.0', '1.0.0')).toBeUndefined();
  });
});

describe('the channel the lane installs', () => {
  it('takes the channel published last, not the highest version: Payload beta over its stopped canary', () => {
    expect(
      chooseChannel(
        {
          latest: '3.92.1',
          beta: '4.0.0-beta.6',
          canary: '4.0.0-canary.39',
          internal: '4.0.0-internal.1a2a79e',
        },
        {
          '4.0.0-beta.6': '2026-10-29T15:00:00.000Z',
          '4.0.0-canary.39': '2026-10-08T15:00:00.000Z',
          '4.0.0-internal.1a2a79e': '2026-10-30T09:00:00.000Z',
        },
      ),
    ).toEqual({ tag: 'beta', version: '4.0.0-beta.6' });
  });

  it('watches nothing when every channel is below latest: a canary of a released React', () => {
    expect(
      chooseChannel(
        {
          latest: '19.3.1',
          canary: '19.3.0-canary-c5ec5c6d-20261029',
          next: '19.3.0-canary-d5736f09-20260507',
          rc: '19.0.0-rc.1',
          experimental: '0.0.0-experimental-c5ec5c6d-20261029',
        },
        { '19.3.0-canary-c5ec5c6d-20261029': '2026-10-29T00:00:00.000Z' },
      ),
    ).toBeUndefined();
  });

  it('picks the newest of several live channels: Vue rc over beta and alpha', () => {
    expect(
      chooseChannel(
        { latest: '3.5.44', rc: '3.6.0-rc.14', beta: '3.6.0-beta.17', alpha: '3.6.0-alpha.7' },
        {
          '3.6.0-rc.14': '2026-10-30T00:00:00.000Z',
          '3.6.0-beta.17': '2026-06-24T00:00:00.000Z',
          '3.6.0-alpha.7': '2025-12-12T00:00:00.000Z',
        },
      ),
    ).toEqual({ tag: 'rc', version: '3.6.0-rc.14' });
  });

  it('ignores branch tags and a registry without latest', () => {
    expect(
      chooseChannel({ latest: '7.4.4', 'next--wasm': '0.0.0-wasm-20220921185024' }, {}),
    ).toBeUndefined();
    expect(chooseChannel({ beta: '1.0.0-beta.1' }, {})).toBeUndefined();
  });
});
