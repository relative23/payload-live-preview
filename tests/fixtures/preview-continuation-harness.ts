/**
 * Local authenticated principals and an in-memory atomic store for ADR 0019.
 * These replace deployment infrastructure, not token verification or fragment
 * authorization; no real Payload ACL or multi-process store is claimed.
 */
import { randomBytes, webcrypto } from 'node:crypto';
import { vi } from 'vitest';
import {
  extractCookie,
  issuePreviewToken,
  type SubtleCryptoLike,
} from '@security/preview-authorization';
import {
  createReferenceContinuation,
  type ContinuationOptions,
  type ContinuationPrincipal,
  type ContinuationRecord,
  type ContinuationTarget,
} from './preview-continuation';

export const CONTINUATION_SITE = 'https://preview.example.test';
export function continuationHarness() {
  // Package consumers check wall-clock expiry too, so no fixed future date
  // may make this fixture fail merely because the calendar caught up.
  let now = Date.now();
  const secret = randomBytes(48).toString('base64url');
  const records = new Map<string, ContinuationRecord>();
  const consumed = new Map<string, number>();
  const target: ContinuationTarget = {
    audience: CONTINUATION_SITE,
    serverURL: 'https://cms.example.test',
    path: '/page',
    locale: 'de',
    document: { kind: 'collection', slug: 'posts', id: 'post-a' },
    depth: 1,
    expiresAt: now + 600_000,
  };
  const principal: ContinuationPrincipal = {
    subject: 'editor-a',
    sessionId: randomBytes(32).toString('base64url'),
    expiresAt: now + 600_000,
    payloadHeaders: { cookie: `payload-token=${randomBytes(32).toString('base64url')}` },
  };
  const loginCookie = `host-login=${randomBytes(32).toString('base64url')}`;
  const principals = new Map([[loginCookie.slice('host-login='.length), principal]]);
  const store = {
    consume: vi.fn((id: string, expiry: number) => {
      if (consumed.has(id)) return false;
      consumed.set(id, expiry);
      return true;
    }),
    publish: vi.fn((key: string, record: ContinuationRecord) => {
      if (records.has(key)) return false;
      records.set(key, record);
      return true;
    }),
    read: vi.fn((key: string) => records.get(key) ?? null),
  };
  const options: ContinuationOptions = {
    secret,
    audience: CONTINUATION_SITE,
    store,
    now: () => now,
    principal: (request) => {
      const key = extractCookie(request.headers.get('cookie'), 'host-login');
      return key === null ? null : (principals.get(key) ?? null);
    },
    binding: () => target,
  };
  const reference = createReferenceContinuation(options);
  return {
    reference,
    options,
    store,
    records,
    consumed,
    principals,
    principal,
    target,
    loginCookie,
    advance: (ms: number) => {
      now += ms;
    },
    request: (path = '/page?preview=true&locale=de', cookie = loginCookie) =>
      new Request(`${CONTINUATION_SITE}${path}`, { headers: { cookie } }),
    token: (
      claims: Parameters<typeof issuePreviewToken>[0] = {
        audience: CONTINUATION_SITE,
        path: '/page',
        locale: 'de',
        subject: principal.subject,
      },
    ) =>
      issuePreviewToken(claims, {
        secret,
        now: () => now,
        crypto: webcrypto as unknown as SubtleCryptoLike,
      }),
  };
}
