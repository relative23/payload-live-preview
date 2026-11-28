import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  createAuthorizedPreviewContext,
  isAuthorizedPreviewContext,
} from '@/runtime/types/authorized-preview';

/**
 * A context is authorized because `authorizePreviewRequest()` made it, and for
 * no other reason. Until 3.0 the mark was a registry symbol, because every
 * entry was a bundle of its own with its own copy of this module, and a mark
 * one copy could not see would have refused the other's contexts. A registry
 * symbol is one anybody can write. Since the entries are one module graph, the
 * module keeps the contexts it made, and nothing else passes (ADR 0007, row 44).
 */
function context() {
  return createAuthorizedPreviewContext({
    strategy: 'verifier',
    subject: undefined,
    authorizedAt: 0,
    expiresAt: undefined,
    scope: {},
    payloadHeaders: {},
  });
}

const OLD_KEY = 'payload-live-preview.authorized-preview-context';

describe('an authorized preview context', () => {
  it('is the object the package made', () => {
    expect(isAuthorizedPreviewContext(context())).toBe(true);
  });

  it('is not an object built by hand with the marks 2.x looked for', () => {
    const forged = Object.freeze({
      strategy: 'verifier',
      subject: 'someone',
      authorizedAt: 0,
      expiresAt: undefined,
      scope: Object.freeze({}),
      payloadHeaders: Object.freeze({}),
      [OLD_KEY]: true,
      [Symbol.for(OLD_KEY)]: true,
    });

    expect(isAuthorizedPreviewContext(forged)).toBe(false);
  });

  it('is not a copy of one, frozen or not, nor what a JSON round trip gives back', () => {
    const value = context();

    expect(isAuthorizedPreviewContext(Object.freeze({ ...value }))).toBe(false);
    expect(isAuthorizedPreviewContext({ ...value })).toBe(false);
    expect(isAuthorizedPreviewContext(JSON.parse(JSON.stringify(value)))).toBe(false);
    expect(isAuthorizedPreviewContext({ authorized: true })).toBe(false);
  });

  it('carries no mark a reader could copy: no symbol, and no key of the old name', () => {
    const value = context();

    expect(Object.getOwnPropertySymbols(value)).toEqual([]);
    expect(OLD_KEY in value).toBe(false);
  });

  it('keeps the forwarded cookie out of every enumeration: JSON, a spread, the keys, a log', () => {
    // The cookie is HttpOnly in the browser; `JSON.stringify(locals)` or a page that returns the
    // context must not hand it to the page.
    const value = createAuthorizedPreviewContext({
      strategy: 'payload-session',
      subject: '7',
      authorizedAt: 0,
      expiresAt: undefined,
      scope: {},
      payloadHeaders: { cookie: 'payload-token=secret.jwt' },
    });
    expect(value.payloadHeaders).toStrictEqual({ cookie: 'payload-token=secret.jwt' });
    expect(JSON.stringify({ livePreviewAuthorization: value })).not.toContain('secret.jwt');
    expect(Object.keys(value)).not.toContain('payloadHeaders');
    expect({ ...value }).not.toHaveProperty('payloadHeaders');
    expect(inspect(value, { depth: 4 })).not.toContain('secret.jwt');
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.payloadHeaders)).toBe(true);
    expect(isAuthorizedPreviewContext(value)).toBe(true);
  });
});
