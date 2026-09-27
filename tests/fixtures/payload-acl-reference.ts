/**
 * Connects the continuation reference to independently verified Payload logins.
 * Credentials stay in this process; the simulated host cookie is only a lookup
 * key, and a real /me request rechecks the Payload session for every operation.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type * as ServerEntry from '../../src/server/index';
import {
  createReferenceContinuation,
  type ContinuationRecord,
  type ContinuationTarget,
} from './preview-continuation';
import { createReferenceDataHandler } from './preview-continuation-data';

export interface ACLFixture {
  readonly origin: string;
  readonly password: string;
  readonly ids: Record<string, string>;
  readonly requests: { path: string; method: string; status: number }[];
  writes(): number;
  close(): Promise<void>;
}

export function createACLReference(fixture: ACLFixture, entry: typeof ServerEntry) {
  const audience = 'https://acl-preview.example.test';
  const secret = randomBytes(48).toString('base64url');
  const records = new Map<string, ContinuationRecord>();
  const consumed = new Set<string>();
  const principals = new Map<string, { subject: string; token: string }>();
  const bindings = new Map<string, ContinuationTarget>();
  const login = async (editor: 'a' | 'b') => {
    const response = await fetch(`${fixture.origin}/api/users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${editor}@fixture.invalid`, password: fixture.password }),
    });
    assert.equal(response.status, 200, 'Real Payload login must succeed');
    const body = (await response.json()) as { token?: unknown; user?: { id?: unknown } };
    assert.equal(typeof body.token, 'string', 'Payload supplies the login credential');
    assert.equal(String(body.user?.id), fixture.ids[`user-${editor}`]);
    const sessionId = randomBytes(32).toString('base64url');
    const identity = { subject: String(body.user?.id), token: body.token as string };
    principals.set(sessionId, identity);
    return { ...identity, cookie: `fixture-login=${sessionId}` };
  };
  const reference = createReferenceContinuation({
    secret,
    audience,
    now: Date.now,
    authorizeRequest: entry.authorizePreviewRequest,
    store: {
      consume: (id) => {
        if (consumed.has(id)) return false;
        consumed.add(id);
        return true;
      },
      publish: (key, record) => {
        if (records.has(key)) return false;
        records.set(key, record);
        return true;
      },
      read: (key) => records.get(key) ?? null,
    },
    principal: async (request) => {
      const sessionId = entry.extractCookie(request.headers.get('cookie'), 'fixture-login');
      const identity = sessionId === null ? undefined : principals.get(sessionId);
      if (identity === undefined || sessionId === null) return null;
      const response = await fetch(`${fixture.origin}/api/users/me`, {
        headers: { authorization: `JWT ${identity.token}` },
        cache: 'no-store',
        redirect: 'error',
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!response.ok) return null;
      const body = (await response.json()) as { user?: { id?: unknown } | null; exp?: unknown };
      if (String(body.user?.id) !== identity.subject || typeof body.exp !== 'number') return null;
      return {
        subject: identity.subject,
        sessionId,
        expiresAt: body.exp * 1000,
        payloadHeaders: { authorization: `JWT ${identity.token}` },
      };
    },
    binding: (_principal, request) => bindings.get(new URL(request.url).pathname) ?? null,
  });
  const data = createReferenceDataHandler(reference, {
    define: entry.definePreview,
    fetch,
    globalDocument: (value, slug) =>
      (slug === 'settings' &&
        typeof value['title'] === 'string' &&
        Array.isArray(value['errors'])) ||
      (slug === 'diagnostics' && typeof value['errors'] === 'string'),
  });
  return {
    reference,
    data,
    login,
    audience,
    bindings,
    async open(
      identity: Awaited<ReturnType<typeof login>>,
      document: ContinuationTarget['document'],
      locale = 'de',
      depth = 2,
    ) {
      const path = `/page-${bindings.size}`;
      bindings.set(path, {
        audience,
        serverURL: fixture.origin,
        path,
        locale,
        document,
        depth,
        expiresAt: Date.now() + 300_000,
      });
      const token = await entry.issuePreviewToken(
        { audience, path, locale, subject: identity.subject },
        { secret },
      );
      const initial = new Request(`${audience}${path}?locale=${locale}&previewToken=${token}`, {
        headers: { cookie: identity.cookie },
      });
      const response = await reference.exchange(initial);
      assert.equal(response.status, 303, 'Valid entry proof must exchange once');
      const continuation = response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(continuation, 'Exchange must acknowledge its grant');
      const url = `${audience}${path}?preview=true&locale=${locale}`;
      const cookie = `${identity.cookie}; ${continuation}`;
      return {
        path,
        url,
        cookie,
        initial,
        continuation,
        request: () => new Request(url, { headers: { cookie } }),
      };
    },
    raw(path: string, token?: string, method = 'GET') {
      return fetch(`${fixture.origin}${path}`, {
        method,
        headers: token === undefined ? {} : { authorization: `JWT ${token}` },
        cache: 'no-store',
        redirect: 'error',
      });
    },
  };
}
