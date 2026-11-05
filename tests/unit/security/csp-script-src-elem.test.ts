import { describe, expect, it } from 'vitest';
import { mergeCspHeader } from '@security/csp';

/**
 * Full mode's nonce goes into script-src, and a policy may also set its own
 * script-src-elem. A browser asks that one for every script element, so the
 * merge has to reach it, by the same 'unsafe-inline' rule as script-src.
 */

describe('mergeCspHeader — a policy that sets its own script-src-elem', () => {
  // A browser asks script-src-elem, where a policy has it, for every script
  // element, so a source added to script-src alone would never reach them.
  it('unions a script-src addition into it as well', () => {
    expect(
      mergeCspHeader("script-src-elem 'self'; script-src 'self'", {
        'script-src': "'self' 'nonce-abc'",
      }),
    ).toBe("script-src-elem 'self' 'nonce-abc'; script-src 'self' 'nonce-abc'");
  });

  it('reaches it when script-src itself comes from the default-src fallback', () => {
    expect(
      mergeCspHeader("default-src 'self'; script-src-elem https://js.example", {
        'script-src': "'nonce-abc'",
      }),
    ).toBe(
      "default-src 'self'; script-src-elem https://js.example 'nonce-abc'; script-src 'self' 'nonce-abc'",
    );
  });

  it("decides on its own 'unsafe-inline', not on script-src's", () => {
    expect(
      mergeCspHeader("script-src-elem 'self' 'unsafe-inline'; script-src 'self'", {
        'script-src': "'self' 'nonce-abc'",
      }),
    ).toBe("script-src-elem 'self' 'unsafe-inline'; script-src 'self' 'nonce-abc'");
    expect(
      mergeCspHeader("script-src-elem 'self'; script-src 'self' 'unsafe-inline'", {
        'script-src': "'self' 'nonce-abc'",
      }),
    ).toBe("script-src-elem 'self' 'nonce-abc'; script-src 'self' 'unsafe-inline'");
  });

  it('finds it whatever the case of its name', () => {
    expect(mergeCspHeader("SCRIPT-SRC-ELEM 'self'", { 'script-src': "'nonce-abc'" })).toBe(
      "script-src-elem 'self' 'nonce-abc'; script-src 'nonce-abc'",
    );
  });

  it('leaves a policy without one as it was, and does not create one', () => {
    expect(mergeCspHeader("script-src 'self'", { 'script-src': "'nonce-abc'" })).toBe(
      "script-src 'self' 'nonce-abc'",
    );
  });

  it('decides for each policy on its own', () => {
    expect(
      mergeCspHeader("script-src-elem 'self'; script-src 'self', script-src 'self'", {
        'script-src': "'nonce-abc'",
      }),
    ).toBe(
      "script-src-elem 'self' 'nonce-abc'; script-src 'self' 'nonce-abc', script-src 'self' 'nonce-abc'",
    );
  });

  it('keeps a replace on the directive it names', () => {
    expect(
      mergeCspHeader("script-src-elem 'self'; script-src 'self'", {
        'script-src': { value: "'nonce-abc'", mode: 'replace' },
      }),
    ).toBe("script-src-elem 'self'; script-src 'nonce-abc'");
  });

  it('carries nothing over from other directives', () => {
    expect(
      mergeCspHeader("script-src-elem 'self'; style-src 'self'", { 'style-src': "'nonce-abc'" }),
    ).toBe("script-src-elem 'self'; style-src 'self' 'nonce-abc'");
  });
});
