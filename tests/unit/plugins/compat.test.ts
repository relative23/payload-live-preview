import { describe, expect, it } from 'vitest';
import { incompatibilityOf, satisfiesRange } from '@plugins/compat';
import { LIBRARY_PROTOCOL_VERSION } from '@core/protocol-version';
import { VERSION } from '@/version';

describe('satisfiesRange', () => {
  it('reads the range forms a plugin author writes', () => {
    expect(satisfiesRange('1.2.3', '*')).toBe(true);
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
    expect(satisfiesRange('1.9.0', '^1.2.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesRange('1.1.9', '^1.2.0')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesRange('1.2.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '>=1.2.0 <2.0.0')).toBe(false);
    expect(satisfiesRange('2.1.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
    expect(satisfiesRange('1.2.3', '>1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.3', '<=1.2.3')).toBe(true);
  });

  it('treats the 0.x caret the way semver does', () => {
    expect(satisfiesRange('0.3.9', '^0.3.0')).toBe(true);
    expect(satisfiesRange('0.4.0', '^0.3.0')).toBe(false);
    expect(satisfiesRange('0.0.2', '^0.0.2')).toBe(true);
    expect(satisfiesRange('0.0.3', '^0.0.2')).toBe(false);
  });

  it('ignores prerelease tags and refuses what it cannot read', () => {
    expect(satisfiesRange('1.9.0-next.1', '^1.2.0')).toBe(true);
    expect(satisfiesRange('nonsense', '^1.0.0')).toBe(false);
    expect(satisfiesRange('1.0.0', 'latest')).toBe(false);
  });
});

describe('incompatibilityOf', () => {
  it('accepts an absent claim and a fitting one', () => {
    expect(incompatibilityOf(undefined, '1.9.0', 4)).toBeUndefined();
    expect(incompatibilityOf({ runtime: '^1.2.0', protocol: 4 }, '1.9.0', 4)).toBeUndefined();
    expect(incompatibilityOf({ protocol: 5 }, '1.9.0', 4)).toBeUndefined();
  });

  it('names the side that does not fit', () => {
    expect(incompatibilityOf({ runtime: '^2.0.0' }, '1.9.0', 4)).toMatch(
      /declares runtime \^2\.0\.0, this runtime is 1\.9\.0/,
    );
    expect(incompatibilityOf({ protocol: 3 }, '1.9.0', 4)).toMatch(
      /declares protocol 3, this runtime speaks 4/,
    );
    expect(incompatibilityOf({ protocol: 0 }, '1.9.0', 4)).toMatch(/invalid protocol/);
    expect(incompatibilityOf({ protocol: 2.5 }, '1.9.0', 4)).toMatch(/invalid protocol/);
  });

  it('accepts the range docs/renderers.md tells plugin authors to write', () => {
    expect(
      incompatibilityOf({ runtime: '>=1.2.0' }, VERSION, LIBRARY_PROTOCOL_VERSION),
    ).toBeUndefined();
    expect(incompatibilityOf({ runtime: '^1.2.0' }, VERSION, LIBRARY_PROTOCOL_VERSION)).toMatch(
      /declares runtime \^1\.2\.0/,
    );
  });
});
