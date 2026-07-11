import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OriginDetector, isLocalhostOrigin, normaliseOrigin } from '@detection/origin';

describe('normaliseOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['http://localhost:3001', 'http://localhost:3001'],
    ['  https://EXAMPLE.com  ', 'https://example.com'],
    ['https://example.com/path?q=1#frag', 'https://example.com'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseOrigin(input)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    'not-a-url',
    'javascript:alert(1)',
    'mailto:foo@example.com',
    'file:///etc/passwd',
    'ftp://example.com',
  ])('rejects %s', (input) => {
    expect(normaliseOrigin(input)).toBeUndefined();
  });
});

describe('isLocalhostOrigin', () => {
  it.each([
    'http://localhost',
    'http://localhost:3000',
    'https://localhost:443',
    'http://127.0.0.1',
    'http://127.0.0.1:8080',
    'HTTP://LOCALHOST:1234',
  ])('matches %s', (input) => {
    expect(isLocalhostOrigin(input)).toBe(true);
  });

  it.each([
    'https://example.com',
    'http://localhost.evil.com',
    'http://127.0.0.2',
    '',
    'localhost:3000',
  ])('does not match %s', (input) => {
    expect(isLocalhostOrigin(input)).toBe(false);
  });
});

describe('OriginDetector — explicit origins', () => {
  it('trusts explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
    expect(detector.matches('https://evil.example.com')).toBe(false);
  });

  it('normalises explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['  https://Admin.Example.COM/path  '],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
  });

  it('ignores invalid explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['not-a-url', '', 'mailto:foo@example.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.matches('https://example.com')).toBe(false);
  });

  it('rejects empty origin and "null"', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.matches('')).toBe(false);
    expect(detector.matches('null')).toBe(false);
  });
});

describe('OriginDetector — referrer detection', () => {
  it('extracts the origin from a referrer URL', () => {
    const detector = new OriginDetector({
      referrer: 'https://admin.example.com/preview',
      enableReferrerDetection: true,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
  });

  it('ignores invalid referrer strings', () => {
    const detector = new OriginDetector({
      referrer: 'not-a-url',
      enableReferrerDetection: true,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(false);
  });

  it('disabling referrer detection prevents matching', () => {
    const detector = new OriginDetector({
      referrer: 'https://admin.example.com/preview',
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(false);
  });

  it('referrerWasAvailable reflects whether a referrer was captured', () => {
    const withReferrer = new OriginDetector({ referrer: 'https://admin.example.com' });
    expect(withReferrer.referrerWasAvailable).toBe(true);
    const without = new OriginDetector({ referrer: '' });
    expect(without.referrerWasAvailable).toBe(false);
  });
});

describe('OriginDetector — localhost pattern', () => {
  it('accepts any localhost port in dev mode', () => {
    const detector = new OriginDetector({ forceDevMode: true, enableReferrerDetection: false });
    expect(detector.matches('http://localhost:3000')).toBe(true);
    expect(detector.matches('http://localhost:54321')).toBe(true);
    expect(detector.matches('http://127.0.0.1:9999')).toBe(true);
  });

  it('rejects localhost in production mode', () => {
    const detector = new OriginDetector({ forceDevMode: false, enableReferrerDetection: false });
    expect(detector.matches('http://localhost:3000')).toBe(false);
  });

  it('honours enableLocalhostMatching=false', () => {
    const detector = new OriginDetector({
      forceDevMode: true,
      enableLocalhostMatching: false,
      enableReferrerDetection: false,
    });
    expect(detector.matches('http://localhost:3000')).toBe(false);
  });
});

describe('OriginDetector — lock', () => {
  it('lockOrigin narrows the trusted set to one entry', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com', 'https://b.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.lockOrigin('https://a.com')).toBe(true);
    expect(detector.lockedOrigin).toBe('https://a.com');
    expect(detector.matches('https://a.com')).toBe(true);
    expect(detector.matches('https://b.com')).toBe(false);
  });

  it('lockOrigin refuses to lock an origin that is not currently trusted', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.lockOrigin('https://evil.com')).toBe(false);
    expect(detector.lockedOrigin).toBeUndefined();
  });

  it('unlockOrigin returns the previously-locked origin', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    detector.lockOrigin('https://a.com');
    expect(detector.unlockOrigin()).toBe('https://a.com');
    expect(detector.lockedOrigin).toBeUndefined();
  });

  it('unlockOrigin returns undefined when nothing was locked', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.unlockOrigin()).toBeUndefined();
  });

  it('after unlock, other allow-listed origins match again', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com', 'https://b.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    detector.lockOrigin('https://a.com');
    expect(detector.matches('https://b.com')).toBe(false);
    detector.unlockOrigin();
    expect(detector.matches('https://b.com')).toBe(true);
    expect(detector.matches('https://a.com')).toBe(true);
  });
});

describe('OriginDetector — enumerate', () => {
  it('returns every trusted origin pre-lock', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com'],
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.enumerate()).toContain('https://a.com');
  });

  it('expands localhost pattern to handshake ports in dev mode', () => {
    const detector = new OriginDetector({
      enableReferrerDetection: false,
      forceDevMode: true,
    });
    const enumerated = detector.enumerate();
    expect(enumerated).toContain('http://localhost:3000');
    expect(enumerated).toContain('http://localhost:5173');
    expect(enumerated).toContain('http://127.0.0.1:3000');
  });

  it('returns a single entry after locking', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://a.com', 'https://b.com'],
      enableReferrerDetection: false,
      forceDevMode: true,
    });
    detector.lockOrigin('https://a.com');
    expect(detector.enumerate()).toEqual(['https://a.com']);
  });
});

describe('OriginDetector — isProductionUnconfigured', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'top', { value: window.top, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(window, 'top', { value: window, configurable: true });
  });

  it('returns false when outside an iframe', () => {
    const detector = new OriginDetector({
      enableReferrerDetection: false,
      forceDevMode: false,
    });
    expect(detector.isProductionUnconfigured).toBe(false);
  });
});
