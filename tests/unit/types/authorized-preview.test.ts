import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  AUTHORIZED_PREVIEW_BRAND_KEY,
  createAuthorizedPreviewContext,
  isAuthorizedPreviewContext,
} from '@/types/authorized-preview';

/**
 * The brand must survive bundling. The root entry and every adapter entry
 * are separate bundles with their own copy of this module; a per-bundle
 * `Symbol()` made `livePreviewHandle` refuse contexts `authorizePreviewRequest`
 * had produced — in the packaged package only, never in a unit test. This
 * pins the registry symbol so the failure cannot come back quietly.
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

describe('authorized preview brand', () => {
  it('is a registry symbol, identical across module copies', () => {
    const value = context();
    const [brand] = Object.getOwnPropertySymbols(value);
    expect(brand).toBe(Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY));
    expect(Symbol.keyFor(brand!)).toBe(AUTHORIZED_PREVIEW_BRAND_KEY);
    // What another bundle's copy of the guard does: the same registry lookup.
    const foreignGuard = (candidate: unknown): boolean =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as Record<symbol, unknown>)[Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY)] === true &&
      Object.isFrozen(candidate);
    expect(foreignGuard(value)).toBe(true);
    expect(isAuthorizedPreviewContext(value)).toBe(true);
  });

  it('still refuses copies and literals — the brand is a look-alike filter, not a secret', () => {
    const value = context();
    expect(isAuthorizedPreviewContext({ ...value })).toBe(false);
    expect(isAuthorizedPreviewContext(JSON.parse(JSON.stringify(value)))).toBe(false);
    expect(isAuthorizedPreviewContext({ authorized: true })).toBe(false);
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
