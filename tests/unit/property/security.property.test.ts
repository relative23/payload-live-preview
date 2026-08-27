import { describe, expect, vi } from 'vitest';
import { fc, it } from '@fast-check/vitest';
import {
  buildFrameAncestors,
  buildScriptSrcWithNonce,
  generateCspNonce,
  mergeCspHeader,
  setCspCrypto,
} from '@security/csp';
import { sanitizeHtml, SANITIZER_POLICY } from '@security/sanitizer';
import { isExternalHttpUrl, isSafeUrl } from '@security/url-validator';
import { normaliseOrigin, OriginDetector } from '@detection/origin';
import { resolveFieldValue } from '@core/field-value';
import { propertyParameters } from './fast-check';

const ASCII_WHITESPACE = fc.constantFrom(' ', '\t', '\n', '\f', '\r', ' \t', '\r\n');
const TOKEN = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/);
const DIRECTIVE_NAME = TOKEN.map((token) => `x-${token}`);
const PATH_SEGMENT = fc
  .stringMatching(/^[a-z][a-z0-9_]{0,8}$/)
  .filter((segment) => !['__proto__', 'prototype', 'constructor'].includes(segment));

function mixedAsciiCase(value: string): string {
  return value.replace(/[a-z]/g, (character, offset: number) =>
    offset % 2 === 0 ? character.toUpperCase() : character,
  );
}

function createNestedRecord(segments: readonly string[], leaf: unknown): Record<string, unknown> {
  const root = Object.create(null) as Record<string, unknown>;
  let cursor = root;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      cursor[segment] = leaf;
    } else {
      const child = Object.create(null) as Record<string, unknown>;
      cursor[segment] = child;
      cursor = child;
    }
  }
  return root;
}

function assertSanitizedTree(output: string): void {
  const template = document.createElement('template');
  template.innerHTML = output;
  for (const element of template.content.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();
    expect(SANITIZER_POLICY.allowedTags.has(tag), `unexpected tag <${tag}>`).toBe(true);
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      expect(name.startsWith('on'), `${tag}[${name}]`).toBe(false);
      expect(name, `${tag}[${name}]`).not.toBe('style');
      if (SANITIZER_POLICY.urlAttributes.has(name)) {
        expect(isSafeUrl(attribute.value), `${tag}[${name}=${attribute.value}]`).toBe(true);
      }
      if (name === 'srcset') {
        for (const candidate of attribute.value.split(',')) {
          const url = candidate.trim().split(/\s+/, 1)[0];
          if (url !== undefined && url.length > 0) {
            expect(isSafeUrl(url), `${tag}[srcset=${attribute.value}]`).toBe(true);
          }
        }
      }
    }
  }
}

describe('security properties', () => {
  it('keeps scheduled property seeds replayable and rejects malformed overrides', () => {
    vi.stubEnv('PLP_PROPERTY_SEED', '-20260814');
    vi.stubEnv('PLP_PROPERTY_RUNS', '1000');
    try {
      expect(propertyParameters(42, 50)).toEqual({ seed: -20260814, numRuns: 1000 });

      vi.stubEnv('PLP_PROPERTY_SEED', '20260814suffix');
      vi.stubEnv('PLP_PROPERTY_RUNS', '1.5');
      expect(propertyParameters(42, 50)).toEqual({ seed: 42, numRuns: 50 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.prop([DIRECTIVE_NAME, TOKEN, TOKEN, TOKEN, ASCII_WHITESPACE], propertyParameters(0x43535031))(
    'parses CSP ASCII whitespace and keeps the first case-insensitive duplicate',
    (name, a, b, c, ws) => {
      const first = `${a}-first`;
      const ignored = `${b}-later`;
      const addition = `${c}-addition`;
      const existing = `${mixedAsciiCase(name)}${ws}${first}; ${name}${ws}${ignored}`;

      expect(mergeCspHeader(existing, { [name]: addition })).toBe(`${name} ${first} ${addition}`);
    },
  );

  it('makes union-style CSP merging a fixed point', () => {
    const source = TOKEN.map((token) => `https://${token}.example`);
    fc.assert(
      fc.property(
        fc.uniqueArray(source, { minLength: 1, maxLength: 8 }),
        fc.uniqueArray(source, { minLength: 1, maxLength: 8 }),
        (existingSources, additions) => {
          const existing = `script-src ${existingSources.join(' ')}`;
          const once = mergeCspHeader(existing, { 'script-src': additions.join(' ') });
          expect(mergeCspHeader(once, { 'script-src': additions.join(' ') })).toBe(once);
        },
      ),
      propertyParameters(0x43535032),
    );
  });

  it('keeps CSP nonce boundaries and diagnostics explicit', () => {
    setCspCrypto({
      getRandomValues: (bytes) => {
        if (bytes instanceof Uint8Array) bytes.fill(0xa5);
        return bytes;
      },
    });
    try {
      expect(generateCspNonce(8)).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(() => generateCspNonce(7)).toThrow(
        'generateCspNonce: bytes must be an integer >= 8, got 7',
      );
      expect(() => buildScriptSrcWithNonce('')).toThrow('buildScriptSrcWithNonce: nonce is empty');
    } finally {
      setCspCrypto(null);
    }
  });

  it('uses browser base64 without requiring the Node Buffer global', () => {
    const originalBtoa = globalThis.btoa;
    setCspCrypto({
      getRandomValues: (bytes) => {
        if (bytes instanceof Uint8Array) bytes.fill(0);
        return bytes;
      },
    });
    vi.stubGlobal('Buffer', undefined);
    vi.stubGlobal('btoa', originalBtoa);
    try {
      expect(generateCspNonce(8)).toBe('AAAAAAAAAAA');
    } finally {
      setCspCrypto(null);
      vi.unstubAllGlobals();
    }
  });

  it('preserves every base64url character substitution in generated nonces', () => {
    const firstBytes = [251, 255];
    setCspCrypto({
      getRandomValues: (bytes) => {
        if (bytes instanceof Uint8Array) {
          bytes.set([firstBytes.shift() ?? 0, 0, 0, 0, 0, 0, 0, 0]);
        }
        return bytes;
      },
    });
    try {
      expect(generateCspNonce(8)).toBe('-wAAAAAAAAA');
      expect(generateCspNonce(8)).toBe('_wAAAAAAAAA');
    } finally {
      setCspCrypto(null);
    }
  });

  it('fails with actionable diagnostics for missing or malformed Web Crypto', () => {
    setCspCrypto(null);
    for (const cryptoValue of [undefined, {}]) {
      vi.stubGlobal('crypto', cryptoValue);
      try {
        expect(() => generateCspNonce(8)).toThrow(
          /Web Crypto is unavailable[\s\S]*Node 18[\s\S]*predictable nonce[\s\S]*CSP/,
        );
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

  it('keeps frame ancestors deduplicated across allow-none combinations', () => {
    expect(buildFrameAncestors({ allowNone: true })).toBe("'self'");
    expect(
      buildFrameAncestors({ self: false, allowNone: true, origins: ['https://admin.test'] }),
    ).toBe('https://admin.test');
    expect(buildFrameAncestors({ origins: ["'self'", "'self'"] })).toBe("'self'");
  });

  it('trims script sources and repeated directive edge whitespace', () => {
    expect(buildScriptSrcWithNonce('nonce', { extra: ['  https://cdn.test  '] })).toBe(
      "'self' 'nonce-nonce' https://cdn.test",
    );
    expect(mergeCspHeader("  \t script-src   'self'  \r\n ; ; ", {})).toBe("script-src 'self'");
  });

  it('retains none when a union contains no real CSP source', () => {
    expect(mergeCspHeader("frame-ancestors 'none'", { 'frame-ancestors': "  'none'  " })).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('rejects every dangerous URL scheme across casing and leading whitespace', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('javascript', 'data', 'vbscript', 'file', 'blob', 'about'),
        fc.boolean(),
        fc.string({ maxLength: 40 }),
        ASCII_WHITESPACE,
        (scheme, upper, suffix, whitespace) => {
          const renderedScheme = upper ? scheme.toUpperCase() : mixedAsciiCase(scheme);
          const candidate = `${whitespace}${renderedScheme}:${suffix}`;
          expect(isSafeUrl(candidate)).toBe(false);
          expect(isExternalHttpUrl(candidate)).toBe(false);
        },
      ),
      propertyParameters(0x55524c31),
    );
  });

  it('accepts canonical HTTP(S) URLs and classifies them as external', () => {
    fc.assert(
      fc.property(
        fc.domain(),
        fc.webPath(),
        fc.constantFrom('http', 'https'),
        (domain, path, scheme) => {
          const candidate = `${scheme}://${domain}${path}`;
          expect(isSafeUrl(candidate)).toBe(true);
          expect(isExternalHttpUrl(candidate)).toBe(true);
        },
      ),
      propertyParameters(0x55524c32),
    );
  });

  it.prop(
    [TOKEN, fc.constantFrom('javascript', 'data', 'vbscript', 'file', 'blob', 'about')],
    propertyParameters(0x55524c33),
  )(
    'rejects dangerous schemes separated from their colon by ASCII whitespace',
    (prefix, scheme) => {
      expect(isSafeUrl(`${scheme}  :${prefix}`)).toBe(false);
      // A dangerous-looking substring in a later relative-path segment is not
      // a URL scheme and must not make safe relative navigation external.
      const relative = `${prefix}/${scheme}:guide`;
      expect(isSafeUrl(relative)).toBe(true);
      expect(isExternalHttpUrl(relative)).toBe(false);
    },
  );

  it('trims safe relative/external URLs but never finds an origin in the middle of a path', () => {
    expect(isSafeUrl('  plain/path  ')).toBe(true);
    expect(isSafeUrl('plain')).toBe(true);
    expect(isSafeUrl('!plain/path')).toBe(false);
    expect(isExternalHttpUrl('  https://example.test/path  ')).toBe(true);
    expect(isExternalHttpUrl('/redirect/https://example.test')).toBe(false);
    expect(isExternalHttpUrl('/path//example.test')).toBe(false);
  });

  it('canonicalizes HTTP(S) origins idempotently and locks to exactly one origin', () => {
    const origin = fc
      .tuple(fc.constantFrom('http', 'https'), fc.domain(), fc.integer({ min: 1, max: 65_535 }))
      .map(([scheme, domain, port]) => `${scheme}://${domain}:${String(port)}`);

    fc.assert(
      fc.property(
        fc.uniqueArray(origin, { minLength: 1, maxLength: 6 }),
        fc.nat(),
        (origins, selected) => {
          const normalized = origins.map((value) => normaliseOrigin(`  ${value}/path?q=1#x  `));
          expect(normalized.every((value): value is string => value !== undefined)).toBe(true);
          const canonical = normalized as string[];
          for (const value of canonical) expect(normaliseOrigin(value)).toBe(value);

          const detector = new OriginDetector({
            additionalOrigins: origins,
            enableReferrerDetection: false,
            enableLocalhostMatching: false,
            forceDevMode: false,
          });
          for (const value of canonical) expect(detector.matches(value)).toBe(true);

          const locked = canonical[selected % canonical.length];
          if (locked === undefined) throw new Error('origin generator produced no values');
          expect(detector.lockOrigin(locked)).toBe(true);
          for (const value of canonical) expect(detector.matches(value)).toBe(value === locked);
        },
      ),
      propertyParameters(0x4f524731),
    );
  });

  it('resolves own nested data paths without traversing pollution-sensitive segments', () => {
    fc.assert(
      fc.property(
        fc.array(PATH_SEGMENT, { minLength: 1, maxLength: 5 }),
        fc.jsonValue(),
        (segments, leaf) => {
          const fields = createNestedRecord(segments, leaf);
          expect(resolveFieldValue(fields, segments.join('.'), undefined)).toEqual(leaf);

          for (const blocked of ['__proto__', 'prototype', 'constructor']) {
            const blockedFields = createNestedRecord(
              [segments[0] ?? 'root', blocked, 'value'],
              leaf,
            );
            expect(
              resolveFieldValue(
                blockedFields,
                `${segments[0] ?? 'root'}.${blocked}.value`,
                undefined,
              ),
            ).toBeUndefined();
          }
        },
      ),
      propertyParameters(0x50415448),
    );
  });

  it.prop([PATH_SEGMENT, fc.jsonValue(), fc.jsonValue()], propertyParameters(0x50415449))(
    'keeps default locale precedence and undefined-locale fallbacks exact',
    (path, direct, localized) => {
      const fields = Object.assign(Object.create(null) as Record<string, unknown>, {
        [path]: direct,
        [`${path}_de`]: localized,
        [`${path}_undefined`]: localized,
      });
      expect(resolveFieldValue(fields, path, 'de')).toEqual(direct);
      expect(resolveFieldValue(fields, path, 'de', true)).toEqual(localized);
      const withoutDirect = Object.assign(Object.create(null) as Record<string, unknown>, {
        [`${path}_de`]: localized,
        [`${path}_undefined`]: localized,
      });
      expect(resolveFieldValue(withoutDirect, path, undefined, true)).toBeUndefined();
    },
  );

  it('stops safely at null and missing intermediate data-path segments', () => {
    expect(resolveFieldValue({ hero: null }, 'hero.title.value', undefined)).toBeUndefined();
    expect(resolveFieldValue({ hero: {} }, 'hero.title.value', undefined)).toBeUndefined();
    expect(resolveFieldValue({ hero: 'text' }, 'hero.0', undefined)).toBeUndefined();
  });

  it('blocks own pollution-sensitive top-level keys', () => {
    for (const blocked of ['__proto__', 'prototype', 'constructor']) {
      const fields = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(fields, blocked, { value: 'blocked', enumerable: true });
      expect(resolveFieldValue(fields, blocked, undefined)).toBeUndefined();
    }
  });

  it('sanitizes arbitrary parser input to a stable allow-listed tree', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (input) => {
        // Both policies: the 2.0 default is one that already holds today.
        for (const policy of ['compat', 'strict'] as const) {
          const output = sanitizeHtml(input, { policy });
          assertSanitizedTree(output);
          expect(sanitizeHtml(output, { policy })).toBe(output);
          if (policy === 'strict') {
            expect(output).not.toMatch(/\s(?:id|name|data-payload-[a-z-]+)=/iu);
          }
        }
      }),
      propertyParameters(0x53414e31, 150),
    );
  });

  it('removes generated active-content attributes and dangerous URL sinks', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('p', 'span', 'div', 'a', 'img', 'video', 'blockquote'),
        fc.constantFrom('javascript', 'data', 'vbscript', 'file', 'blob'),
        TOKEN,
        (tag, scheme, token) => {
          const input = `<${tag} onclick="${token}()" style="url(${scheme}:x)" href="${scheme}:${token}" src="${scheme}:${token}" poster="${scheme}:${token}">${token}<script>${token}()</script></${tag}>`;
          for (const policy of ['compat', 'strict'] as const) {
            const output = sanitizeHtml(input, { policy });
            assertSanitizedTree(output);
            expect(output.toLowerCase()).not.toContain('<script');
          }
        },
      ),
      propertyParameters(0x53414e32),
    );
  });
});
