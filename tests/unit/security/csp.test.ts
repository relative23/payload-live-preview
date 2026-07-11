import { afterEach, describe, expect, it } from 'vitest';
import {
  generateCspNonce,
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  mergeCspHeader,
  setCspCrypto,
} from '@security/csp';

describe('generateCspNonce', () => {
  it('returns a base64url string of expected length for default 16 bytes', () => {
    const nonce = generateCspNonce();
    // 16 bytes → ceil(16/3*4) = 22 chars without padding
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('produces unique values across invocations', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    const c = generateCspNonce();
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('honours custom byte length', () => {
    const nonce = generateCspNonce(32);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects byte counts below the 8-byte floor', () => {
    expect(() => generateCspNonce(7)).toThrow(RangeError);
  });

  it('rejects non-integer byte counts', () => {
    expect(() => generateCspNonce(16.5)).toThrow(RangeError);
  });

  it('falls back to Buffer.from when btoa is unavailable', () => {
    const originalBtoa = globalThis.btoa;
    // @ts-expect-error — simulating Node-only runtime
    delete globalThis.btoa;
    try {
      const nonce = generateCspNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    } finally {
      globalThis.btoa = originalBtoa;
    }
  });

  it('throws when Web Crypto is unavailable instead of returning predictable values', () => {
    const original = globalThis.crypto;
    // @ts-expect-error — simulating absence
    delete globalThis.crypto;
    try {
      expect(() => generateCspNonce()).toThrow(/Web Crypto is unavailable/);
    } finally {
      globalThis.crypto = original;
    }
  });
});

describe('setCspCrypto — Node 18 fallback', () => {
  afterEach(() => {
    setCspCrypto(null);
  });

  it('uses the injected crypto when globalThis.crypto is unavailable', () => {
    const original = globalThis.crypto;
    // @ts-expect-error — simulating Node 18 without --experimental-global-webcrypto
    delete globalThis.crypto;
    try {
      let called = 0;
      setCspCrypto({
        getRandomValues<T extends ArrayBufferView | null>(array: T): T {
          called += 1;
          if (array instanceof Uint8Array) {
            for (let i = 0; i < array.length; i += 1) array[i] = (i + 1) & 0xff;
          }
          return array;
        },
      });
      const nonce = generateCspNonce();
      expect(called).toBe(1);
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    } finally {
      globalThis.crypto = original;
    }
  });

  it('prefers the injected crypto over the global one', () => {
    let called = 0;
    setCspCrypto({
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        called += 1;
        if (array instanceof Uint8Array) array.fill(0xab);
        return array;
      },
    });
    generateCspNonce();
    expect(called).toBe(1);
  });

  it('clears the override when null is passed', () => {
    let called = 0;
    setCspCrypto({
      getRandomValues<T extends ArrayBufferView | null>(array: T): T {
        called += 1;
        return array;
      },
    });
    generateCspNonce();
    expect(called).toBe(1);

    setCspCrypto(null);
    // Override gone — should now use the real globalThis.crypto.
    generateCspNonce();
    expect(called).toBe(1);
  });

  it('still throws when override is missing AND globalThis.crypto is unavailable', () => {
    const original = globalThis.crypto;
    // @ts-expect-error — simulating absence
    delete globalThis.crypto;
    try {
      setCspCrypto(null);
      expect(() => generateCspNonce()).toThrow(/Web Crypto is unavailable/);
    } finally {
      globalThis.crypto = original;
    }
  });
});

describe('buildFrameAncestors', () => {
  it('returns "self" by default', () => {
    expect(buildFrameAncestors()).toBe("'self'");
  });

  it('returns "none" when allowNone and no sources given', () => {
    expect(buildFrameAncestors({ self: false, allowNone: true })).toBe("'none'");
  });

  it('returns "none" when self is false, no origins, and allowNone is false', () => {
    expect(buildFrameAncestors({ self: false })).toBe("'none'");
  });

  it('joins self and origins', () => {
    expect(
      buildFrameAncestors({
        self: true,
        origins: ['https://admin.example.com', 'https://staging.example.com'],
      }),
    ).toBe("'self' https://admin.example.com https://staging.example.com");
  });

  it('omits self when self=false but origins are given', () => {
    expect(buildFrameAncestors({ self: false, origins: ['https://x.com'] })).toBe('https://x.com');
  });

  it('deduplicates and trims origins', () => {
    expect(
      buildFrameAncestors({
        self: false,
        origins: ['  https://x.com  ', 'https://x.com', '', '   '],
      }),
    ).toBe('https://x.com');
  });
});

describe('buildScriptSrcWithNonce', () => {
  it('builds a nonce policy without strict-dynamic by default', () => {
    // strict-dynamic makes CSP-3 browsers ignore 'self' and host
    // sources, which breaks framework hydration scripts — opt-in only.
    expect(buildScriptSrcWithNonce('abc123')).toBe("'self' 'nonce-abc123'");
  });

  it('adds strict-dynamic when explicitly requested', () => {
    expect(buildScriptSrcWithNonce('abc123', { strictDynamic: true })).toBe(
      "'self' 'nonce-abc123' 'strict-dynamic'",
    );
  });

  it('omits self when requested', () => {
    expect(buildScriptSrcWithNonce('abc123', { self: false })).toBe("'nonce-abc123'");
  });

  it('appends extra sources after the nonce', () => {
    expect(buildScriptSrcWithNonce('abc123', { extra: ['https://cdn.example.com', ''] })).toBe(
      "'self' 'nonce-abc123' https://cdn.example.com",
    );
  });

  it('rejects empty nonce', () => {
    expect(() => buildScriptSrcWithNonce('')).toThrow(RangeError);
  });
});

describe('mergeCspHeader', () => {
  it('unions sources into an existing directive instead of replacing it', () => {
    const merged = mergeCspHeader("script-src 'self' https://cdn.example.com", {
      'script-src': "'nonce-abc'",
    });
    expect(merged).toBe("script-src 'self' https://cdn.example.com 'nonce-abc'");
  });

  it('preserves unrelated directives', () => {
    const merged = mergeCspHeader("default-src 'self'; img-src https:", {
      'frame-ancestors': "'self' https://admin.example.com",
    });
    expect(merged).toContain("default-src 'self'");
    expect(merged).toContain('img-src https:');
    expect(merged).toContain("frame-ancestors 'self' https://admin.example.com");
  });

  it("drops 'none' when real sources are merged in", () => {
    const merged = mergeCspHeader("frame-ancestors 'none'", {
      'frame-ancestors': "'self' https://admin.example.com",
    });
    expect(merged).toBe("frame-ancestors 'self' https://admin.example.com");
  });

  it('replaces the directive when mode is replace', () => {
    const merged = mergeCspHeader("script-src 'unsafe-inline'", {
      'script-src': { value: "'nonce-abc'", mode: 'replace' },
    });
    expect(merged).toBe("script-src 'nonce-abc'");
  });

  it('deduplicates repeated sources', () => {
    const merged = mergeCspHeader("frame-ancestors 'self'", {
      'frame-ancestors': "'self' https://a.example",
    });
    expect(merged).toBe("frame-ancestors 'self' https://a.example");
  });
});
