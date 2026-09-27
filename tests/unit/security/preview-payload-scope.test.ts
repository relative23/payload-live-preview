import { describe, expect, it } from 'vitest';
import {
  authorizePreviewRequest,
  AUTHORIZED_PREVIEW_BRAND_KEY,
  isAuthorizedPreviewContext,
  type PreviewVerifierClaims,
} from '@security/preview-authorization';
import { scopedClaims, scopedContext, SCOPE_CMS, SCOPE_SITE } from '../../fixtures/scoped-preview';

describe('verifier Payload capability', () => {
  it('keeps the public verifier name and cross-entry brand literal', async () => {
    const context = await scopedContext();
    expect(context.strategy).toBe('verifier');
    expect(AUTHORIZED_PREVIEW_BRAND_KEY).toBe('payload-live-preview.authorized-preview-context');
    expect(context[AUTHORIZED_PREVIEW_BRAND_KEY]).toBe(true);
    const notAnObject = Object.freeze(
      Object.assign(() => undefined, { [Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY)]: true }),
    );
    expect(isAuthorizedPreviewContext(notAnObject)).toBe(false);
    const unbranded = Object.freeze({
      ...context,
      [Symbol.for(AUTHORIZED_PREVIEW_BRAND_KEY)]: false,
    });
    expect(isAuthorizedPreviewContext(unbranded)).toBe(false);
  });

  it('refuses at the exact expiry boundary but leaves unbounded legacy verifiers usable', async () => {
    const now = Date.now();
    expect(
      await authorizePreviewRequest(new Request(SCOPE_SITE), {
        type: 'verifier',
        now: () => now,
        verify: () => ({ ...scopedClaims(), expiresAt: now }),
      }),
    ).toMatchObject({ authorized: false, outcome: 'expired' });
    expect(
      await authorizePreviewRequest(new Request(SCOPE_SITE), {
        type: 'verifier',
        now: () => now,
        verify: () => ({}),
      }),
    ).toMatchObject({
      authorized: true,
      outcome: 'authorized',
      context: { strategy: 'verifier', expiresAt: undefined },
    });
  });
  it('copies and freezes nested authority before a caller can widen it', async () => {
    const claims = scopedClaims();
    const scope = claims.scope!.payload!;
    const context = await scopedContext(claims);
    Object.assign(scope, { maxDepth: 99, serverURL: 'https://other.test' });
    Object.assign(scope.document, { id: 'post-b' });
    expect(context.scope.payload).toEqual({
      serverURL: SCOPE_CMS,
      maxDepth: 1,
      document: { kind: 'collection', slug: 'posts', id: 'post-a' },
    });
    expect(Object.isFrozen(context.scope.payload)).toBe(true);
    expect(Object.isFrozen(context.scope.payload!.document)).toBe(true);
  });

  it.each([
    null,
    {},
    { maxDepth: -1 },
    { maxDepth: 1.5 },
    { maxDepth: Infinity },
    { maxDepth: NaN },
    { maxDepth: Number.MAX_SAFE_INTEGER + 1 },
    { serverURL: 'file:///etc' },
    { serverURL: 'relative' },
    { serverURL: 42 },
    { serverURL: new URL(SCOPE_CMS) },
    { serverURL: Object(SCOPE_CMS) as unknown },
    { serverURL: 'ftp://cms.example.test' },
    { serverURL: 'https://user@cms.example.test' },
    { serverURL: 'https://:pass@cms.example.test' },
    { serverURL: `\n${SCOPE_CMS}` },
    { apiRoute: null },
    { apiRoute: Object('/api') as unknown },
    { serverURL: `${SCOPE_CMS}/x/../y` },
    { serverURL: `${SCOPE_CMS}/%2e%2e` },
    { serverURL: `${SCOPE_CMS}?query=1` },
    { serverURL: `${SCOPE_CMS}#hash` },
    { serverURL: 'https://user:pass@cms.test' },
    { apiRoute: '/api/../users' },
    { apiRoute: '/api?x=1' },
    { apiRoute: '/api\\users' },
    { apiRoute: '//api' },
    { apiRoute: '' },
    { document: null },
    { document: {} },
    { document: { kind: 'other', slug: 'posts' } },
    { document: { kind: 'collection', slug: 'posts' } },
    { document: { kind: 'collection', slug: 'posts', id: {} } },
    { document: { kind: 'collection', slug: 'posts', id: NaN } },
    { document: { kind: 'collection', slug: 'posts', id: '' } },
    { document: { kind: 'collection', slug: 'posts', id: '..' } },
    { document: { kind: 'collection', slug: 'posts', id: '.' } },
    { document: { kind: 'other', slug: 'posts', id: 'post-a' } },
    { document: { kind: 'collection', slug: 'posts', id: '%2fsecret' } },
    { document: { kind: 'collection', slug: 'posts', id: '\ud800' } },
    { document: { kind: 'global', slug: '../users' } },
  ])('refuses malformed capability %# without minting a context', async (change) => {
    const claims = scopedClaims();
    const payload = change === null ? null : { ...claims.scope!.payload!, ...change };
    // An untyped application may deserialize claims from a store.
    const unsafe = {
      ...claims,
      scope: { ...claims.scope, payload },
    } as unknown as PreviewVerifierClaims;
    if (change !== null && Object.keys(change).length === 0) {
      Object.assign(unsafe.scope!.payload!, { document: undefined });
    }
    expect(
      await authorizePreviewRequest(new Request(SCOPE_SITE), {
        type: 'verifier',
        verify: () => unsafe,
      }),
    ).toMatchObject({ authorized: false, outcome: 'invalid', context: null });
  });

  it('refuses callable claims even when they carry all capability properties', async () => {
    const claims = scopedClaims();
    const unsafe = {
      ...claims,
      scope: {
        ...claims.scope,
        payload: Object.assign(() => undefined, claims.scope!.payload),
      },
    } as unknown as PreviewVerifierClaims;
    expect(
      await authorizePreviewRequest(new Request(SCOPE_SITE), {
        type: 'verifier',
        verify: () => unsafe,
      }),
    ).toMatchObject({ authorized: false, outcome: 'invalid', context: null });
  });

  it.each([undefined, Infinity, NaN])(
    'requires a finite expiry for the new capability (%s)',
    async (expiresAt) => {
      const claims = { ...scopedClaims(), expiresAt } as PreviewVerifierClaims;
      expect(
        await authorizePreviewRequest(new Request(SCOPE_SITE), {
          type: 'verifier',
          verify: () => claims,
        }),
      ).toMatchObject({ authorized: false, outcome: 'invalid' });
    },
  );

  it.each([0, 17, '17', 'uuid-like-1', '文書'])(
    'accepts safe IDs including zero (%s)',
    async (id) => {
      const claims = scopedClaims();
      const context = await scopedContext({
        ...claims,
        scope: {
          ...claims.scope,
          payload: {
            ...claims.scope!.payload!,
            document: { kind: 'collection', slug: 'posts', id },
          },
        },
      });
      expect(context.scope.payload!.document).toEqual({ kind: 'collection', slug: 'posts', id });
    },
  );
});
