import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetTrustedTypesForTests,
  TRUSTED_TYPES_POLICY_NAME,
  setTrustedTypesPolicy,
  trustedHtml,
} from '@security/trusted-types';
import { sanitizeHtml } from '@security/sanitizer';
import { buildBuiltinRenderers } from '@field-types/index';
import type { CachedElement, RenderContext } from '@core/types';

/**
 * Trusted Types (roadmap 1.3.0): under enforcement every HTML sink must
 * receive a `TrustedHTML`. The package creates one policy on first use and
 * routes every sink through it; a site may hand in its own; without the API
 * strings pass through.
 */

class FakeTrustedHTML {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

function installFakeApi(options: { refuse?: boolean } = {}) {
  const created: string[] = [];
  const api = {
    createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
      if (options.refuse === true) throw new TypeError(`Policy "${name}" disallowed`);
      created.push(name);
      return { createHTML: (input: string) => new FakeTrustedHTML(rules.createHTML(input)) };
    },
  };
  (globalThis as { trustedTypes?: unknown }).trustedTypes = api;
  return created;
}

afterEach(() => {
  delete (globalThis as { trustedTypes?: unknown }).trustedTypes;
  __resetTrustedTypesForTests();
});

describe('trustedHtml', () => {
  it('returns the string unchanged without the API', () => {
    expect(trustedHtml('<p>x</p>')).toBe('<p>x</p>');
  });

  it('creates the package policy once and wraps every sink value with it', () => {
    const created = installFakeApi();
    const a = trustedHtml('<p>a</p>') as unknown;
    const b = trustedHtml('<p>b</p>') as unknown;
    expect(created).toEqual([TRUSTED_TYPES_POLICY_NAME]);
    expect(a).toBeInstanceOf(FakeTrustedHTML);
    expect(String(b)).toBe('<p>b</p>');
  });

  it('prefers a policy the site handed in, and can be told to pass strings through', () => {
    installFakeApi();
    const mine = { createHTML: vi.fn((input: string) => `mine:${input}`) };
    setTrustedTypesPolicy(mine);
    expect(trustedHtml('<i>x</i>')).toBe('mine:<i>x</i>');
    setTrustedTypesPolicy(null);
    expect(trustedHtml('<i>x</i>')).toBe('<i>x</i>');
  });

  it('tolerates a CSP that refuses the policy name and lets the sink report enforcement', () => {
    installFakeApi({ refuse: true });
    expect(() => trustedHtml('<p>x</p>')).not.toThrow();
    expect(trustedHtml('<p>x</p>')).toBe('<p>x</p>');
  });
});

describe('sinks under an enforcing policy', () => {
  it('routes the sanitizer parse and every renderer write through the policy', () => {
    installFakeApi();
    const createHTML = vi.fn((input: string) => new FakeTrustedHTML(input));
    setTrustedTypesPolicy({ createHTML });
    // jsdom accepts an object with toString() for innerHTML, which is what an
    // enforcing browser does with a real TrustedHTML.
    expect(sanitizeHtml('<b>x</b><script>y()</script>')).toBe('<b>x</b>');
    expect(createHTML).toHaveBeenCalledWith('<b>x</b><script>y()</script>');
    const renderers = buildBuiltinRenderers();
    const context: RenderContext = { allFields: {}, locale: undefined, schema: undefined };
    const target = (fieldType: string) =>
      ({
        element: document.createElement('div'),
        fieldName: 'f',
        fieldType,
      }) as unknown as CachedElement;
    createHTML.mockClear();
    renderers['html']?.render(target('html'), '<em>h</em>', context);
    renderers['richText']?.render(target('richText'), '<em>r</em>', context);
    renderers['textarea']?.render(target('textarea'), 'line\nbreak', context);
    expect(createHTML.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const call of createHTML.mock.calls) expect(call[0]).not.toContain('<script');
  });
});
