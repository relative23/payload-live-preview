import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizePreviewRequest,
  extractCookie,
  isAuthorizedPreviewContext,
  issuePreviewToken,
  type FetchLike,
  type PayloadSessionStrategy,
  type PreviewAuthorizationRequest,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
} from '@security/preview-authorization';

/**
 * ADR 0006 made executable. Every refusal outcome the record names has a
 * test that produces it, and the one success path proves the context is the
 * branded, frozen object the gates check for.
 */

const crypto = webcrypto as unknown as SubtleCryptoLike;
const SITE = 'https://www.example.com';
const CMS = 'https://cms.example.com';
const SECRET = 'a-secret-that-is-at-least-thirty-two-bytes-long';
const NOW = 1_800_000_000_000;

function request(url: string, headers: Record<string, string> = {}): PreviewAuthorizationRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, headers: { get: (name) => map.get(name.toLowerCase()) ?? null } };
}

describe('extractCookie', () => {
  it('returns exactly one named value and nothing else', () => {
    expect(extractCookie('a=1; payload-token=abc.def; b=2', 'payload-token')).toBe('abc.def');
  });

  it('refuses an absent, empty, repeated, oversized or non-token value', () => {
    expect(extractCookie(null, 'payload-token')).toBeNull();
    expect(extractCookie('', 'payload-token')).toBeNull();
    expect(extractCookie('other=1', 'payload-token')).toBeNull();
    expect(extractCookie('payload-token=', 'payload-token')).toBeNull();
    expect(extractCookie('payload-token=a; payload-token=b', 'payload-token')).toBeNull();
    expect(extractCookie(`payload-token=${'x'.repeat(5000)}`, 'payload-token')).toBeNull();
    expect(extractCookie('payload-token=abc;def', 'payload-token')).toBe('abc');
    expect(extractCookie('payload-token=a"b', 'payload-token')).toBeNull();
    expect(extractCookie('payload-token=a b', 'payload-token')).toBeNull();
  });

  it('does not match a cookie whose name merely starts with the wanted one', () => {
    expect(extractCookie('payload-token-old=zzz', 'payload-token')).toBeNull();
  });
});

describe('payload-session strategy', () => {
  function fetchReturning(status: number, body: unknown, seen: unknown[] = []): FetchLike {
    return (input, init) => {
      seen.push({ input, headers: init.headers });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      });
    };
  }

  const base: Omit<PayloadSessionStrategy, 'fetch'> = {
    type: 'payload-session',
    serverURL: CMS,
    now: () => NOW,
  };

  it('authorizes a user from /me and forwards exactly the one cookie', async () => {
    const seen: { input: string; headers: Record<string, string> }[] = [];
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?preview=true`, { cookie: 'session=zzz; payload-token=tok.en' }),
      {
        ...base,
        fetch: fetchReturning(
          200,
          { user: { id: 7 }, collection: 'users', exp: NOW / 1000 + 600 },
          seen,
        ),
      },
    );
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(result.outcome).toBe('authorized');
    expect(isAuthorizedPreviewContext(result.context)).toBe(true);
    expect(result.context.strategy).toBe('payload-session');
    expect(result.context.subject).toBe('7');
    expect(result.context.expiresAt).toBe(NOW + 600_000);
    expect(result.context.payloadHeaders).toEqual({ cookie: 'payload-token=tok.en' });
    expect(seen[0]?.input).toBe(`${CMS}/api/users/me?depth=0`);
    expect(seen[0]?.headers['cookie']).toBe('payload-token=tok.en');
    expect(Object.isFrozen(result.context)).toBe(true);
  });

  it('refuses without a cookie as missing-credential and never calls the server', async () => {
    const fetch = vi.fn<FetchLike>();
    const result = await authorizePreviewRequest(request(`${SITE}/`), { ...base, fetch });
    expect(result).toEqual({ authorized: false, outcome: 'missing-credential', context: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a 401 as invalid and any other failure as unavailable', async () => {
    const withCookie = request(`${SITE}/`, { cookie: 'payload-token=x' });
    expect(
      (await authorizePreviewRequest(withCookie, { ...base, fetch: fetchReturning(401, {}) }))
        .outcome,
    ).toBe('invalid');
    expect(
      (await authorizePreviewRequest(withCookie, { ...base, fetch: fetchReturning(502, {}) }))
        .outcome,
    ).toBe('unavailable');
    const failing: FetchLike = () => Promise.reject(new Error('down'));
    expect((await authorizePreviewRequest(withCookie, { ...base, fetch: failing })).outcome).toBe(
      'unavailable',
    );
    const badJson: FetchLike = () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('html')) });
    expect((await authorizePreviewRequest(withCookie, { ...base, fetch: badJson })).outcome).toBe(
      'unavailable',
    );
  });

  it('refuses a body without a user, or a user of another auth collection', async () => {
    const withCookie = request(`${SITE}/`, { cookie: 'payload-token=x' });
    expect(
      (
        await authorizePreviewRequest(withCookie, {
          ...base,
          fetch: fetchReturning(200, { user: null }),
        })
      ).outcome,
    ).toBe('invalid');
    expect(
      (
        await authorizePreviewRequest(withCookie, {
          ...base,
          fetch: fetchReturning(200, { user: { id: 1 }, collection: 'customers' }),
        })
      ).outcome,
    ).toBe('invalid');
    expect(
      (
        await authorizePreviewRequest(withCookie, {
          ...base,
          usersSlug: 'editors',
          fetch: fetchReturning(200, { user: { id: 1, collection: 'editors' } }),
        })
      ).authorized,
    ).toBe(true);
  });

  it('refuses a session the server reports as already expired', async () => {
    const withCookie = request(`${SITE}/`, { cookie: 'payload-token=x' });
    const result = await authorizePreviewRequest(withCookie, {
      ...base,
      fetch: fetchReturning(200, { user: { id: 1 }, exp: NOW / 1000 - 1 }),
    });
    expect(result.outcome).toBe('expired');
  });

  it('raises configuration errors loudly instead of refusing quietly', async () => {
    const withCookie = request(`${SITE}/`, { cookie: 'payload-token=x' });
    await expect(
      authorizePreviewRequest(withCookie, {
        ...base,
        cookieName: 'bad name',
        fetch: fetchReturning(200, {}),
      }),
    ).rejects.toThrow(/cookie name/);
    await expect(
      authorizePreviewRequest(withCookie, {
        ...base,
        serverURL: 'cms.example.com',
        fetch: fetchReturning(200, {}),
      }),
    ).rejects.toThrow(/absolute URL/);
  });
});

describe('signed-token strategy', () => {
  const strategy: SignedTokenStrategy = {
    type: 'signed-token',
    secret: SECRET,
    audience: SITE,
    crypto,
    now: () => NOW,
  };

  async function token(
    overrides: Partial<Parameters<typeof issuePreviewToken>[0]> = {},
    now = NOW,
  ) {
    return issuePreviewToken(
      { audience: SITE, path: '/page', ...overrides },
      { secret: SECRET, crypto, now: () => now },
    );
  }

  it('authorizes a fresh token bound to this site and path', async () => {
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${await token()}`),
      strategy,
    );
    expect(result.authorized).toBe(true);
    if (!result.authorized) return;
    expect(result.context.strategy).toBe('signed-token');
    expect(result.context.scope).toEqual({ audience: SITE, path: '/page' });
    expect(result.context.expiresAt).toBe(NOW + 10 * 60_000);
    expect(result.context.payloadHeaders).toEqual({});
  });

  it('reads the token from a header when configured so', async () => {
    const result = await authorizePreviewRequest(
      request(`${SITE}/page`, { 'x-preview-token': await token() }),
      {
        ...strategy,
        transport: { kind: 'header' },
      },
    );
    expect(result.authorized).toBe(true);
  });

  it('refuses each binding violation with its own outcome', async () => {
    const at = async (url: string, s: SignedTokenStrategy = strategy) =>
      (await authorizePreviewRequest(request(url), s)).outcome;
    expect(await at(`${SITE}/page`)).toBe('missing-credential');
    expect(await at(`${SITE}/page?previewToken=nonsense`)).toBe('invalid');
    expect(
      await at(`${SITE}/page?previewToken=${await token()}&previewToken=${await token()}`),
    ).toBe('missing-credential');
    expect(await at(`${SITE}/other?previewToken=${await token()}`)).toBe('wrong-path');
    expect(
      await at(
        `${SITE}/page?previewToken=${await token({ audience: 'https://staging.example.com' })}`,
      ),
    ).toBe('wrong-audience');
    expect(await at(`${SITE}/page?previewToken=${await token({ purpose: 'download' })}`)).toBe(
      'wrong-purpose',
    );
    expect(await at(`${SITE}/page?previewToken=${await token({}, NOW - 11 * 60_000)}`)).toBe(
      'expired',
    );
    expect(await at(`${SITE}/page?previewToken=${await token({ locale: 'de' })}`)).toBe(
      'wrong-locale',
    );
    expect(
      await at(`${SITE}/page?previewToken=${await token({ locale: 'de' })}`, {
        ...strategy,
        locale: () => 'th',
      }),
    ).toBe('wrong-locale');
    expect(
      await at(`${SITE}/page?previewToken=${await token({ locale: 'de' })}`, {
        ...strategy,
        locale: () => 'de',
      }),
    ).toBe('authorized');
  });

  it('refuses a token signed with another secret, or tampered after signing', async () => {
    const other = await issuePreviewToken(
      { audience: SITE, path: '/page' },
      { secret: 'another-secret-that-is-also-long-enough-to-pass', crypto, now: () => NOW },
    );
    expect(
      (await authorizePreviewRequest(request(`${SITE}/page?previewToken=${other}`), strategy))
        .outcome,
    ).toBe('invalid');
    const good = await token();
    const [v, payload, sig] = good.split('.');
    const forged = `${v ?? ''}.${payload ?? ''}A.${sig ?? ''}`;
    expect(
      (await authorizePreviewRequest(request(`${SITE}/page?previewToken=${forged}`), strategy))
        .outcome,
    ).toBe('invalid');
    const swapped = await token({ path: '/other' });
    const [, otherPayload] = swapped.split('.');
    const spliced = `${v ?? ''}.${otherPayload ?? ''}.${sig ?? ''}`;
    expect(
      (await authorizePreviewRequest(request(`${SITE}/other?previewToken=${spliced}`), strategy))
        .outcome,
    ).toBe('invalid');
  });

  it('consults the replay store once verified and refuses a seen id', async () => {
    const used = new Set<string>();
    const replay = {
      isUsed: (id: string) => used.has(id),
      markUsed: (id: string) => {
        used.add(id);
      },
    };
    const url = `${SITE}/page?previewToken=${await token()}`;
    expect((await authorizePreviewRequest(request(url), { ...strategy, replay })).outcome).toBe(
      'authorized',
    );
    expect((await authorizePreviewRequest(request(url), { ...strategy, replay })).outcome).toBe(
      'replayed',
    );
    // A bad token never reaches the store.
    expect(used.size).toBe(1);
    await authorizePreviewRequest(request(`${SITE}/page?previewToken=junk`), {
      ...strategy,
      replay,
    });
    expect(used.size).toBe(1);
  });

  it('caps the lifetime at one hour and refuses a short secret at construction', async () => {
    const long = await token({ ttlMs: 24 * 60 * 60_000 });
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${long}`),
      strategy,
    );
    expect(result.authorized && result.context.expiresAt).toBe(NOW + 60 * 60_000);
    await expect(
      issuePreviewToken({ audience: SITE }, { secret: 'short', crypto }),
    ).rejects.toThrow(/32 bytes/);
    await expect(
      authorizePreviewRequest(request(`${SITE}/page`), { ...strategy, secret: 'short' }),
    ).rejects.toThrow(/32 bytes/);
  });

  it('reports a missing crypto implementation as unavailable, never as authorized', async () => {
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${await token()}`),
      {
        ...strategy,
        crypto: {
          subtle: { importKey: () => Promise.reject(new Error('no')) },
        } as unknown as SubtleCryptoLike,
      },
    );
    expect(result.outcome).toBe('unavailable');
  });

  it('issues tokens that are URL-safe and carry no secret', async () => {
    const t = await token({ subject: 'editor-1' });
    expect(t).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(t)).toBe(t);
    const payload = JSON.parse(
      Buffer.from(t.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({
      v: 1,
      aud: SITE,
      pth: '/page',
      sub: 'editor-1',
      pur: 'live-preview',
    });
    expect(JSON.stringify(payload)).not.toContain(SECRET);
  });
});

describe('verifier strategy', () => {
  it('turns returned claims into a branded context and null into a refusal', async () => {
    const accepted = await authorizePreviewRequest(request(`${SITE}/`), {
      type: 'verifier',
      now: () => NOW,
      verify: () => ({
        subject: 'sso:42',
        scope: { locale: 'de' },
        payloadHeaders: { authorization: 'Bearer x' },
      }),
    });
    expect(accepted.authorized).toBe(true);
    if (!accepted.authorized) return;
    expect(isAuthorizedPreviewContext(accepted.context)).toBe(true);
    expect(accepted.context).toMatchObject({
      strategy: 'verifier',
      subject: 'sso:42',
      scope: { locale: 'de' },
    });
    expect(accepted.context.payloadHeaders).toEqual({ authorization: 'Bearer x' });
    const refused = await authorizePreviewRequest(request(`${SITE}/`), {
      type: 'verifier',
      verify: () => null,
    });
    expect(refused).toEqual({ authorized: false, outcome: 'invalid', context: null });
  });

  it('reports a throwing verifier as unavailable and an expired claim as expired', async () => {
    const threw = await authorizePreviewRequest(request(`${SITE}/`), {
      type: 'verifier',
      verify: () => Promise.reject(new Error('idp down')),
    });
    expect(threw.outcome).toBe('unavailable');
    const stale = await authorizePreviewRequest(request(`${SITE}/`), {
      type: 'verifier',
      now: () => NOW,
      verify: () => ({ expiresAt: NOW - 1 }),
    });
    expect(stale.outcome).toBe('expired');
  });
});

describe('isAuthorizedPreviewContext', () => {
  it('rejects every look-alike: literals, booleans, copies and JSON round trips', async () => {
    const real = await authorizePreviewRequest(request(`${SITE}/`), {
      type: 'verifier',
      verify: () => ({}),
    });
    if (!real.authorized) throw new Error('expected authorization');
    expect(isAuthorizedPreviewContext(real.context)).toBe(true);
    expect(isAuthorizedPreviewContext(true)).toBe(false);
    expect(isAuthorizedPreviewContext({ authorized: true })).toBe(false);
    expect(isAuthorizedPreviewContext({ ...real.context })).toBe(false);
    expect(isAuthorizedPreviewContext(JSON.parse(JSON.stringify(real.context)))).toBe(false);
    expect(isAuthorizedPreviewContext(null)).toBe(false);
  });
});
