/**
 * Failure and isolation contracts for the application-side continuation
 * reference. No assertion substitutes a fake verifier for signed entry proof;
 * host login and storage remain explicit local test doubles.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createReferenceContinuation } from '../../fixtures/preview-continuation';
import {
  continuationHarness,
  CONTINUATION_SITE,
} from '../../fixtures/preview-continuation-harness';

async function open(h: ReturnType<typeof continuationHarness>, reference = h.reference) {
  const token = await h.token();
  const request = h.request(`/page?locale=de&previewToken=${token}`);
  const response = await reference.exchange(request);
  const pair = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { request, response, pair, cookie: `${h.loginCookie}; ${pair}` };
}

describe('continuation reference isolation', () => {
  it('retains only a hashed bearer and returns a scoped, bounded host cookie after publication', async () => {
    const h = continuationHarness();
    const { response, pair, cookie } = await open(h);
    expect(response.status).toBe(303);
    const header = response.headers.get('set-cookie')!;
    expect(/^__Host-plp-preview-[a-f0-9]{64}=[A-Za-z0-9_-]{43};/u.test(header)).toBe(true);
    expect(header).toContain('; Path=/; Max-Age=300; Secure; HttpOnly; SameSite=Strict');
    expect(header.includes('Domain=')).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('location')).toBe('/page?preview=true&locale=de');
    expect(await response.text()).toBe('');
    expect(h.records.size).toBe(1);
    const [key, record] = [...h.records][0]!;
    expect(/^[a-f0-9]{64}$/u.test(key)).toBe(true);
    expect(key === pair.split('=')[1]).toBe(false);
    expect(JSON.stringify(record).includes('payload-token')).toBe(false);
    const grant = await h.reference.authorize(h.request(undefined, cookie));
    expect(grant?.context.payloadHeaders['cookie'] === h.principal.payloadHeaders['cookie']).toBe(
      true,
    );
    expect(Object.isFrozen(grant?.context)).toBe(true);
    expect(Object.isFrozen(record.target.document)).toBe(true);
  });

  it('publishes at most one grant for simultaneous entry at two coordinator instances', async () => {
    const h = continuationHarness();
    const second = createReferenceContinuation(h.options);
    const token = await h.token();
    const request = h.request(`/page?locale=de&previewToken=${token}`);
    const responses = await Promise.all([
      h.reference.exchange(request),
      second.exchange(request),
      h.reference.exchange(request),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([303, 403, 403]);
    expect(responses.filter((r) => r.headers.has('set-cookie'))).toHaveLength(1);
    expect(h.store.publish).toHaveBeenCalledTimes(1);
    expect(h.records.size).toBe(1);
  });

  it('isolates two independently logged-in users and their own grants', async () => {
    const h = continuationHarness();
    const alice = await open(h);
    const bobKey = randomBytes(32).toString('base64url');
    h.principals.set(bobKey, { ...h.principal, subject: 'editor-b', sessionId: 'login-b' });
    const token = await h.token({
      audience: CONTINUATION_SITE,
      path: '/page',
      locale: 'de',
      subject: 'editor-b',
    });
    const entry = await h.reference.exchange(
      h.request(`/page?locale=de&previewToken=${token}`, `host-login=${bobKey}`),
    );
    expect(entry.status).toBe(303);
    const bobPair = entry.headers.get('set-cookie')!.split(';')[0]!;
    const bobCookie = `host-login=${bobKey}; ${bobPair}`;
    expect((await h.reference.authorize(h.request(undefined, alice.cookie)))?.context.subject).toBe(
      'editor-a',
    );
    expect((await h.reference.authorize(h.request(undefined, bobCookie)))?.context.subject).toBe(
      'editor-b',
    );
    expect(
      await h.reference.authorize(h.request(undefined, `host-login=${bobKey}; ${alice.pair}`)),
    ).toBeNull();
    expect(
      await h.reference.authorize(h.request(undefined, `${h.loginCookie}; ${bobPair}`)),
    ).toBeNull();
  });

  it('keeps a sub-second grant usable only until its server-side expiry', async () => {
    const h = continuationHarness();
    const token = await h.token({
      audience: CONTINUATION_SITE,
      path: '/page',
      locale: 'de',
      subject: h.principal.subject,
      ttlMs: 750,
    });
    const entry = await h.reference.exchange(h.request(`/page?locale=de&previewToken=${token}`));
    expect(entry.status).toBe(303);
    expect(entry.headers.get('set-cookie')).toContain('Max-Age=1;');
    const cookie = `${h.loginCookie}; ${entry.headers.get('set-cookie')!.split(';')[0]!}`;
    h.advance(749);
    expect((await h.reference.authorize(h.request(undefined, cookie))) !== null).toBe(true);
    h.advance(1);
    expect(await h.reference.authorize(h.request(undefined, cookie))).toBeNull();
  });

  it.each(['another-user', 'another-login', 'logout'] as const)(
    'refuses %s even with the right continuation cookie',
    async (change) => {
      const h = continuationHarness();
      const opened = await open(h);
      const key = h.loginCookie.slice('host-login='.length);
      if (change === 'logout') h.principals.delete(key);
      else {
        h.principals.set(key, {
          ...h.principal,
          ...(change === 'another-user' ? { subject: 'editor-b' } : { sessionId: 'another-login' }),
        });
      }
      expect(await h.reference.authorize(h.request(undefined, opened.cookie))).toBeNull();
    },
  );

  it.each(['/other?locale=de', '/page?locale=fr', '/page', '/page?locale=de&locale=de'])(
    'refuses a route or locale outside the grant: %s',
    async (path) => {
      const h = continuationHarness();
      const { cookie } = await open(h);
      expect(await h.reference.authorize(h.request(path, cookie))).toBeNull();
    },
  );

  it.each(['audience', 'document', 'collection', 'kind', 'depth'] as const)(
    'does not broaden a stored %s binding',
    async (field) => {
      const h = continuationHarness();
      const { cookie } = await open(h);
      const altered = {
        ...h.target,
        ...(field === 'audience' ? { audience: 'https://other.example.test' } : {}),
        ...(field === 'depth' ? { depth: 2 } : {}),
        ...(field === 'document'
          ? { document: { kind: 'collection', slug: 'posts', id: 'post-b' } as const }
          : {}),
        ...(field === 'collection'
          ? { document: { kind: 'collection', slug: 'private', id: 'post-a' } as const }
          : {}),
        ...(field === 'kind' ? { document: { kind: 'global', slug: 'posts' } as const } : {}),
      };
      const other = createReferenceContinuation({ ...h.options, binding: () => altered });
      expect(await other.authorize(h.request(undefined, cookie))).toBeNull();
    },
  );

  it('checks stored scope even when a record is returned for the wrong key', async () => {
    const h = continuationHarness();
    const { cookie } = await open(h);
    const record = [...h.records.values()][0]!;
    h.store.read.mockReturnValue({ ...record, target: { ...record.target, depth: 9 } });
    expect(await h.reference.authorize(h.request(undefined, cookie))).toBeNull();
  });

  it.each(['record', 'login', 'mapping'] as const)(
    'rechecks %s expiry without renewing it',
    async (source) => {
      const h = continuationHarness();
      const { cookie } = await open(h);
      const expireAt = h.options.now() + 2_000;
      if (source === 'record') {
        const [key, record] = [...h.records][0]!;
        h.records.set(key, { ...record, expiresAt: expireAt });
      } else if (source === 'login') {
        h.principals.set(h.loginCookie.slice('host-login='.length), {
          ...h.principal,
          expiresAt: expireAt,
        });
      }
      const reference =
        source === 'mapping'
          ? createReferenceContinuation({
              ...h.options,
              binding: () => ({ ...h.target, expiresAt: expireAt }),
            })
          : h.reference;
      h.advance(1_999);
      expect((await reference.authorize(h.request(undefined, cookie))) !== null).toBe(true);
      h.advance(1);
      expect(await reference.authorize(h.request(undefined, cookie))).toBeNull();
      expect(h.store.publish).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['entry', 'login', 'mapping', 'ceiling'] as const)(
    'bounds the issued lifetime by %s',
    async (source) => {
      const h = continuationHarness();
      if (source === 'login') {
        h.principals.set(h.loginCookie.slice('host-login='.length), {
          ...h.principal,
          expiresAt: h.options.now() + 2_000,
        });
      }
      const reference =
        source === 'mapping'
          ? createReferenceContinuation({
              ...h.options,
              binding: () => ({ ...h.target, expiresAt: h.options.now() + 2_000 }),
            })
          : h.reference;
      const token = await h.token({
        audience: CONTINUATION_SITE,
        path: '/page',
        locale: 'de',
        subject: h.principal.subject,
        ttlMs: source === 'entry' ? 2_000 : 600_000,
      });
      const response = await reference.exchange(h.request(`/page?locale=de&previewToken=${token}`));
      expect(response.status).toBe(303);
      const expiresAt = [...h.records.values()][0]!.expiresAt;
      expect(expiresAt - h.options.now()).toBe(source === 'ceiling' ? 300_000 : 2_000);
    },
  );

  it('reads revocation and fresh principal headers on every continuation', async () => {
    const h = continuationHarness();
    const { cookie } = await open(h);
    const fresh = `payload-token=${randomBytes(32).toString('base64url')}`;
    h.principals.set(h.loginCookie.slice('host-login='.length), {
      ...h.principal,
      payloadHeaders: { cookie: fresh },
    });
    const grant = await h.reference.authorize(h.request(undefined, cookie));
    expect(grant?.context.payloadHeaders['cookie'] === fresh).toBe(true);
    h.records.clear();
    expect(await h.reference.authorize(h.request(undefined, cookie))).toBeNull();
    expect(h.store.read).toHaveBeenCalledTimes(2);
    const revoked = createReferenceContinuation({ ...h.options, binding: () => null });
    expect(await revoked.authorize(h.request(undefined, cookie))).toBeNull();
  });

  it.each(['missing', 'duplicate', 'malformed', 'unknown'] as const)(
    'refuses a %s continuation without replaying the entry',
    async (kind) => {
      const h = continuationHarness();
      const opened = await open(h);
      const name = opened.pair.split('=')[0]!;
      const cookies = {
        missing: h.loginCookie,
        duplicate: `${opened.cookie}; ${opened.pair}`,
        malformed: `${h.loginCookie}; ${name}=short`,
        unknown: `${h.loginCookie}; ${name}=${randomBytes(32).toString('base64url')}`,
      };
      expect(await h.reference.authorize(h.request(undefined, cookies[kind]))).toBeNull();
      expect(h.store.consume).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['subject', 'path', 'locale', 'purpose'] as const)(
    'refuses missing or wrong signed %s before publication',
    async (claim) => {
      const h = continuationHarness();
      const token = await h.token({
        audience: CONTINUATION_SITE,
        ...(claim === 'path' ? {} : { path: '/page' }),
        ...(claim === 'locale' ? {} : { locale: 'de' }),
        ...(claim === 'subject' ? {} : { subject: h.principal.subject }),
        ...(claim === 'purpose' ? { purpose: 'another-purpose' } : {}),
      });
      const response = await h.reference.exchange(
        h.request(`/page?locale=de&previewToken=${token}`),
      );
      expect(response.status).toBe(403);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(h.store.publish).not.toHaveBeenCalled();
    },
  );

  it('uses separate cookies for two server-mapped documents and preserves both grants', async () => {
    const h = continuationHarness();
    const a = await open(h);
    const secondTarget = {
      ...h.target,
      path: '/second',
      document: { kind: 'global', slug: 'homepage' } as const,
    };
    const second = createReferenceContinuation({ ...h.options, binding: () => secondTarget });
    const token = await h.token({
      audience: CONTINUATION_SITE,
      path: '/second',
      locale: 'de',
      subject: h.principal.subject,
    });
    const b = await second.exchange(h.request(`/second?locale=de&previewToken=${token}`));
    expect(b.status).toBe(303);
    const bPair = b.headers.get('set-cookie')!.split(';')[0]!;
    expect(bPair.split('=')[0] === a.pair.split('=')[0]).toBe(false);
    const both = `${a.cookie}; ${bPair}`;
    expect((await h.reference.authorize(h.request(undefined, both)))?.target.document).toEqual(
      h.target.document,
    );
    expect((await second.authorize(h.request('/second?locale=de', both)))?.target.document).toEqual(
      secondTarget.document,
    );
  });

  it('accepts a one-time header entry but does not require that bearer for continuation', async () => {
    const h = continuationHarness();
    const reference = createReferenceContinuation({ ...h.options, transport: { kind: 'header' } });
    const request = h.request();
    request.headers.set('x-preview-token', await h.token());
    const response = await reference.exchange(request);
    expect(response.status).toBe(303);
    const cookie = `${h.loginCookie}; ${response.headers.get('set-cookie')!.split(';')[0]!}`;
    expect((await reference.authorize(h.request(undefined, cookie))) !== null).toBe(true);
    expect((await reference.exchange(request)).status).toBe(403);
  });

  it.each(['missing-store', 'consume', 'publish-false', 'publish-throw', 'read'] as const)(
    'fails closed for %s',
    async (failure) => {
      const h = continuationHarness();
      if (failure === 'consume') {
        h.store.consume.mockImplementation(() => {
          throw new Error('private backend detail');
        });
      }
      if (failure === 'publish-false') h.store.publish.mockReturnValue(false);
      if (failure === 'publish-throw') {
        h.store.publish.mockImplementation(() => {
          throw new Error('private backend detail');
        });
      }
      const reference =
        failure === 'missing-store'
          ? createReferenceContinuation({ ...h.options, store: undefined })
          : h.reference;
      const opened = await open(h, reference);
      if (failure === 'read') {
        h.store.read.mockImplementation(() => {
          throw new Error('private backend detail');
        });
        expect(await reference.authorize(h.request(undefined, opened.cookie))).toBeNull();
      } else {
        expect([403, 503]).toContain(opened.response.status);
        expect(opened.response.headers.has('set-cookie')).toBe(false);
        expect(await opened.response.text()).toBe('');
        expect(opened.response.headers.get('cache-control')).toBe('private, no-store');
      }
      if (failure.startsWith('publish')) {
        h.store.publish.mockImplementation((key, record) => {
          h.records.set(key, record);
          return true;
        });
        expect((await reference.exchange(opened.request)).status).toBe(403);
        expect(h.consumed.size).toBe(1);
      }
    },
  );

  it('does not disclose a committed handle when its acknowledgement is lost', async () => {
    const h = continuationHarness();
    h.store.publish.mockImplementation((key, record) => {
      h.records.set(key, record);
      throw new Error('lost acknowledgement');
    });
    const opened = await open(h);
    expect(opened.response.status).toBe(503);
    expect(opened.response.headers.has('set-cookie')).toBe(false);
    expect(h.records.size).toBe(1);
    expect((await h.reference.exchange(opened.request)).status).toBe(403);
  });

  it('does not publish a cookie before commit, or after abort during commit', async () => {
    const h = continuationHarness();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const reference = createReferenceContinuation({
      ...h.options,
      store: {
        ...h.store,
        publish: async (key, record) => {
          entered();
          await waiting;
          return h.store.publish(key, record);
        },
      },
    });
    const controller = new AbortController();
    const token = await h.token();
    const original = h.request(`/page?locale=de&previewToken=${token}`);
    const request = new Request(original, { signal: controller.signal });
    let settled = false;
    const result = reference.exchange(request).then((value) => {
      settled = true;
      return value;
    });
    await started;
    expect(settled).toBe(false);
    controller.abort();
    release();
    const response = await result;
    expect(response.status).toBe(403);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect((await reference.exchange(original)).status).toBe(403);
  });

  it.each(['origin', 'site', 'scheme', 'host', 'no-login', 'method'] as const)(
    'does not consume proof from an invalid %s request',
    async (failure) => {
      const h = continuationHarness();
      const token = await h.token();
      const url = new URL(`/page?locale=de&previewToken=${token}`, CONTINUATION_SITE);
      if (failure === 'scheme') url.protocol = 'http:';
      if (failure === 'host') url.hostname = 'other.example.test';
      const request = new Request(url, {
        method: failure === 'method' ? 'POST' : 'GET',
        headers: {
          ...(failure === 'no-login' ? {} : { cookie: h.loginCookie }),
          ...(failure === 'origin' ? { origin: 'https://foreign.example.test' } : {}),
          ...(failure === 'site' ? { 'sec-fetch-site': 'cross-site' } : {}),
        },
      });
      const response = await h.reference.exchange(request);
      expect([403, 405]).toContain(response.status);
      expect(response.headers.has('set-cookie')).toBe(false);
      expect(h.store.consume).not.toHaveBeenCalled();
    },
  );
});
