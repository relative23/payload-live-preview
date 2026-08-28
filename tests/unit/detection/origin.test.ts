import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OriginDetector, normaliseOrigin } from '@detection/origin';

const PRODUCTION = { enableReferrerDetection: false, forceDevMode: false } as const;

function fakeIframe(): void {
  Object.defineProperty(window, 'top', {
    get: () => {
      throw new Error('cross-origin');
    },
    configurable: true,
  });
}

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

describe('OriginDetector — explicit origins', () => {
  it('trusts explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      ...PRODUCTION,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
    expect(detector.matches('https://evil.example.com')).toBe(false);
  });

  it('normalises explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['  https://Admin.Example.COM/path  '],
      ...PRODUCTION,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
  });

  it('ignores invalid explicit origins', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['not-a-url', '', 'mailto:foo@example.com'],
      ...PRODUCTION,
    });
    expect(detector.matches('https://example.com')).toBe(false);
  });

  it('rejects empty origin and "null"', () => {
    const detector = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      ...PRODUCTION,
    });
    expect(detector.matches('')).toBe(false);
    expect(detector.matches('null')).toBe(false);
  });

  it('does not read PAYLOAD_ADMIN_ORIGIN from the environment: a browser bundle never could', () => {
    process.env['PAYLOAD_ADMIN_ORIGIN'] = 'https://env.example.com';
    try {
      const detector = new OriginDetector(PRODUCTION);
      expect(detector.matches('https://env.example.com')).toBe(false);
      expect(detector.enumerate()).toEqual([]);
    } finally {
      delete process.env['PAYLOAD_ADMIN_ORIGIN'];
    }
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
      ...PRODUCTION,
    });
    expect(detector.matches('https://admin.example.com')).toBe(false);
  });

  it('referrerWasAvailable reflects whether a referrer was captured', () => {
    const withReferrer = new OriginDetector({ referrer: 'https://admin.example.com' });
    expect(withReferrer.referrerWasAvailable).toBe(true);
    const without = new OriginDetector({ referrer: '' });
    expect(without.referrerWasAvailable).toBe(false);
  });

  it('referrer is a fallback, NOT a union member: explicit origins pin the allow-list', () => {
    // document.referrer names whoever framed the page — in an attack, the attacker.
    const detector = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      referrer: 'https://attacker.example/framing-page',
      enableReferrerDetection: true,
      forceDevMode: false,
    });
    expect(detector.matches('https://admin.example.com')).toBe(true);
    expect(detector.matches('https://attacker.example')).toBe(false);
    expect(detector.enumerate()).not.toContain('https://attacker.example');
  });

  it('isReferrerOnlyTrust is true exactly when the referrer is the only source', () => {
    const only = new OriginDetector({
      referrer: 'https://admin.example.com',
      enableReferrerDetection: true,
      forceDevMode: false,
    });
    expect(only.isReferrerOnlyTrust).toBe(true);
    const pinned = new OriginDetector({
      additionalOrigins: ['https://admin.example.com'],
      referrer: 'https://admin.example.com',
      enableReferrerDetection: true,
      forceDevMode: false,
    });
    expect(pinned.isReferrerOnlyTrust).toBe(false);
    const dev = new OriginDetector({
      referrer: 'https://admin.example.com',
      enableReferrerDetection: true,
      forceDevMode: true,
    });
    expect(dev.isReferrerOnlyTrust).toBe(false);
    const none = new OriginDetector({ referrer: '', forceDevMode: false });
    expect(none.isReferrerOnlyTrust).toBe(false);
  });
});

describe('OriginDetector — localhost pattern', () => {
  it.each([
    'http://localhost',
    'http://localhost:3000',
    'https://localhost:443',
    'http://127.0.0.1',
    'http://127.0.0.1:8080',
    'HTTP://LOCALHOST:1234',
  ])('accepts %s in dev mode', (origin) => {
    const detector = new OriginDetector({ forceDevMode: true, enableReferrerDetection: false });
    expect(detector.matches(origin)).toBe(true);
  });

  it.each(['https://example.com', 'http://localhost.evil.com', 'http://127.0.0.2'])(
    'rejects %s even in dev mode',
    (origin) => {
      const detector = new OriginDetector({ forceDevMode: true, enableReferrerDetection: false });
      expect(detector.matches(origin)).toBe(false);
    },
  );

  it('rejects localhost in production mode', () => {
    const detector = new OriginDetector(PRODUCTION);
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
  const two = (): OriginDetector =>
    new OriginDetector({ additionalOrigins: ['https://a.com', 'https://b.com'], ...PRODUCTION });

  it('lockOrigin narrows the trusted set to one entry', () => {
    const detector = two();
    expect(detector.lockOrigin('https://a.com')).toBe(true);
    expect(detector.lockedOrigin).toBe('https://a.com');
    expect(detector.matches('https://a.com')).toBe(true);
    expect(detector.matches('https://b.com')).toBe(false);
  });

  it('lockOrigin refuses to lock an origin that is not currently trusted', () => {
    const detector = two();
    expect(detector.lockOrigin('https://evil.com')).toBe(false);
    expect(detector.lockedOrigin).toBeUndefined();
  });

  it('unlockOrigin returns the previously-locked origin, or undefined', () => {
    const detector = two();
    expect(detector.unlockOrigin()).toBeUndefined();
    detector.lockOrigin('https://a.com');
    expect(detector.unlockOrigin()).toBe('https://a.com');
    expect(detector.lockedOrigin).toBeUndefined();
  });

  it('lock → unlock → re-lock: every allow-listed origin is trusted again in between and the new lock holds', () => {
    const detector = two();
    detector.lockOrigin('https://a.com');
    expect(detector.matches('https://b.com')).toBe(false);
    detector.unlockOrigin();
    expect(detector.matches('https://b.com')).toBe(true);
    expect(detector.matches('https://a.com')).toBe(true);
    expect(detector.enumerate()).toEqual(['https://a.com', 'https://b.com']);
    expect(detector.lockOrigin('https://b.com')).toBe(true);
    expect(detector.matches('https://a.com')).toBe(false);
    expect(detector.enumerate()).toEqual(['https://b.com']);
  });
});

describe('OriginDetector — enumerate', () => {
  it('returns every trusted origin pre-lock', () => {
    const detector = new OriginDetector({ additionalOrigins: ['https://a.com'], ...PRODUCTION });
    expect(detector.enumerate()).toContain('https://a.com');
  });

  it('expands localhost pattern to handshake ports in dev mode', () => {
    const detector = new OriginDetector({ enableReferrerDetection: false, forceDevMode: true });
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
  let top: PropertyDescriptor | undefined;
  beforeEach(() => {
    top = Object.getOwnPropertyDescriptor(window, 'top');
  });
  afterEach(() => {
    if (top !== undefined) Object.defineProperty(window, 'top', top);
  });

  it('returns false when outside an iframe', () => {
    const detector = new OriginDetector(PRODUCTION);
    expect(detector.isProductionUnconfigured).toBe(false);
  });

  it('returns true inside an iframe with no explicit origin, no referrer and no dev mode', () => {
    fakeIframe();
    const detector = new OriginDetector({ referrer: '', ...PRODUCTION });
    expect(detector.isProductionUnconfigured).toBe(true);
  });

  it.each([
    ['an explicit origin', { additionalOrigins: ['https://a.com'], ...PRODUCTION }],
    [
      'a referrer',
      { referrer: 'https://a.com', enableReferrerDetection: true, forceDevMode: false },
    ],
    ['dev mode', { referrer: '', enableReferrerDetection: false, forceDevMode: true }],
  ])('returns false inside an iframe with %s', (_label, options) => {
    fakeIframe();
    expect(new OriginDetector(options).isProductionUnconfigured).toBe(false);
  });
});
