import { describe, expect, it } from 'vitest';
import { distTagForVersion, releaseTagForVersion } from '../../scripts/release-version';

describe('release versions', () => {
  it('tags stable and prerelease git releases, and refuses a non-version', () => {
    expect(releaseTagForVersion('1.0.4')).toBe('v1.0.4');
    expect(releaseTagForVersion('2.0.0-beta.1')).toBe('v2.0.0-beta.1');
    expect(() => releaseTagForVersion('latest')).toThrow(/version/u);
  });

  it('routes a prerelease to its own npm dist-tag and never to latest', () => {
    expect(distTagForVersion('2.0.0-beta.0', '1.8.1')).toBe('beta');
    expect(distTagForVersion('2.0.0-rc.3', '1.8.1')).toBe('rc');
    expect(distTagForVersion('1.8.2-rc.0', '2.0.0')).toBe('rc');
    expect(() => distTagForVersion('not-a-version', '1.8.1')).toThrow(/version/u);
  });

  it('keeps latest on the newest major: a stable lower major goes to legacy', () => {
    // Before 2.0.0 a 1.x fix is still what `npm install` should resolve…
    expect(distTagForVersion('1.8.2', '1.8.1')).toBe('latest');
    // …after it, `--tag latest` would move latest back to 1.x.
    expect(distTagForVersion('1.8.2', '2.0.0')).toBe('legacy');
    expect(distTagForVersion('1.9.0', '2.3.1')).toBe('legacy');
    expect(distTagForVersion('2.0.0', '1.8.1')).toBe('latest');
    expect(distTagForVersion('2.0.1', '2.0.0')).toBe('latest');
    expect(distTagForVersion('2.0.0', '2.0.0-rc.0')).toBe('latest');
    // A first publish has no latest to compare with.
    expect(distTagForVersion('1.0.4', undefined)).toBe('latest');
  });

  it('refuses to move latest backwards within its major', () => {
    expect(() => distTagForVersion('2.0.5', '2.1.0')).toThrow(/backwards/u);
    expect(() => distTagForVersion('2.1.0', '2.1.1')).toThrow(/backwards/u);
    // A rerun for the version latest already serves is not a step back.
    expect(distTagForVersion('2.1.1', '2.1.1')).toBe('latest');
    expect(() => distTagForVersion('2.1.1', 'next')).toThrow(/latest version/u);
  });
});
