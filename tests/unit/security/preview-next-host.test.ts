/**
 * Host wiring must not promote form fields or a cookie-shaped string to a
 * principal. These source tests complement, not replace, the isolated Next
 * production/browser journey with real Payload login and ACL responses.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { issuePreviewToken } from '@/server/index';
import { createNextHostReference } from '../../fixtures/preview-next-host';

const urlText = (url: RequestInfo | URL): string =>
  url instanceof Request ? url.url : String(url);

function harness(enabled = true) {
  let now = Date.now();
  let revoked = false;
  const audience = 'https://localhost:4274';
  const secret = randomBytes(48).toString('base64url');
  const credential = randomBytes(32).toString('base64url');
  const calls = vi.fn<typeof fetch>().mockImplementation((url, init) => {
    const path = new URL(urlText(url)).pathname;
    if (path.endsWith('/login')) {
      return Promise.resolve(
        Response.json({
          token: credential,
          exp: Math.floor(now / 1000) + 300,
          user: { id: 1, editor: 'a' },
        }),
      );
    }
    expect(new Headers(init?.headers).get('authorization') === `JWT ${credential}`).toBe(true);
    if (path.endsWith('/me')) {
      return Promise.resolve(
        Response.json({
          exp: Math.floor(now / 1000) + 300,
          user: revoked ? null : { id: 1, editor: 'a' },
        }),
      );
    }
    if (path.endsWith('/logout')) {
      revoked = true;
      return Promise.resolve(Response.json({ ok: true }));
    }
    return Promise.resolve(Response.json({ id: 3, title: 'Private draft' }));
  });
  const host = createNextHostReference({
    enabled,
    audience,
    secret,
    serverURL: 'http://127.0.0.1:1234',
    ids: { 'user-a': '1', 'user-b': '2', 'article-a': '3', 'article-b': '4' },
    fetch: calls,
    now: () => now,
  });
  const request = (
    path = '/continuation/a/de?preview=true&locale=de',
    cookie = '',
    method = 'GET',
    data?: unknown,
    token?: string,
  ) =>
    new Request(`${audience}${path}`, {
      method,
      headers: {
        cookie,
        origin: audience,
        ...(token ? { 'x-preview-token': token } : {}),
        ...(data ? { 'content-type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const login = async () => {
    const result = await host.login(
      request('/login', '', 'POST', { email: 'a@fixture.invalid', password: 'local test' }),
    );
    expect(result.status).toBe(204);
    return result.headers.get('set-cookie')!.split(';')[0]!;
  };
  const token = () =>
    issuePreviewToken(
      { audience, path: '/continuation/a/de', locale: 'de', subject: '1' },
      { secret, now: () => now },
    );
  return {
    host,
    calls,
    request,
    login,
    token,
    revoke: () => {
      revoked = true;
    },
    advance: () => {
      now += 301_000;
    },
  };
}

describe('native host login reference', () => {
  it('shares one successful page decision with its server load without serializing credentials', async () => {
    const h = harness();
    const login = await h.login();
    const opened = await h.host.exchange(
      h.request(undefined, login, 'GET', undefined, await h.token()),
    );
    const cookie = `${login}; ${opened.headers.get('set-cookie')!.split(';')[0]}`;
    h.calls.mockClear();
    const result = await h.host.page(h.request(undefined, cookie));
    expect(result.response.status).toBe(200);
    expect(result.authorization?.subject).toBe('1');
    expect(result.authorization?.scope.payload?.document).toEqual({
      kind: 'collection',
      slug: 'articles',
      id: '3',
    });
    expect(h.calls.mock.calls.filter(([url]) => urlText(url).endsWith('/me'))).toHaveLength(1);
    expect(h.calls.mock.calls.filter(([url]) => urlText(url).includes('/articles/'))).toHaveLength(
      1,
    );
    expect(await result.response.json()).toEqual({
      version: 1,
      ok: true,
      data: { id: 3, title: 'Private draft' },
    });
    const anonymous = await h.host.page(h.request());
    expect(anonymous.authorization).toBeNull();
    expect(anonymous.response.status).toBe(403);
  });
  it('withholds the page context when a read or target fails and isolates concurrent pages', async () => {
    const h = harness();
    const login = await h.login();
    const opened = await h.host.exchange(
      h.request(undefined, login, 'GET', undefined, await h.token()),
    );
    const cookie = `${login}; ${opened.headers.get('set-cookie')!.split(';')[0]}`;
    const [valid, foreign] = await Promise.all([
      h.host.page(h.request(undefined, cookie)),
      h.host.page(h.request('/continuation/b/de?preview=true&locale=de', cookie)),
    ]);
    expect(valid.authorization?.subject).toBe('1');
    expect(foreign.authorization).toBeNull();
    expect(foreign.response.status).toBe(403);
    h.calls.mockResolvedValueOnce(
      Response.json({ exp: Math.floor(Date.now() / 1000) + 300, user: { id: 1, editor: 'a' } }),
    );
    h.calls.mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 }));
    const failed = await h.host.page(h.request(undefined, cookie));
    expect(failed.authorization).toBeNull();
    expect(failed.response.status).toBe(502);
  });
  it('stops a stalled login body on request abort and releases its reader', async () => {
    const h = harness();
    const controller = new AbortController();
    let source!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        source = value;
      },
    });
    const request = new Request('https://localhost:4274/login', {
      method: 'POST',
      headers: { origin: 'https://localhost:4274', 'content-type': 'application/json' },
      body,
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit);
    let ended = false;
    const pending = h.host.login(request).then((value) => {
      ended = true;
      return value;
    });
    try {
      await vi.waitFor(() => expect(body.locked).toBe(true));
      controller.abort();
      await vi.waitFor(() => expect(ended).toBe(true), { timeout: 100 });
      expect((await pending).status).toBe(403);
      expect(body.locked).toBe(false);
      expect(h.calls).not.toHaveBeenCalled();
    } finally {
      if (body.locked) source.close();
      await pending;
    }
  });
  it('refuses the disabled route before login or private reads', async () => {
    const h = harness(false);
    expect(
      (await h.host.login(h.request('/login', '', 'POST', { email: 'a', password: 'b' }))).status,
    ).toBe(403);
    expect((await h.host.load(h.request())).status).toBe(403);
    expect(h.calls).not.toHaveBeenCalled();
  });
  it('refuses an anonymous entry without consuming a proof', async () => {
    const h = harness();
    const token = await h.token();
    expect((await h.host.exchange(h.request(undefined, '', 'GET', undefined, token))).status).toBe(
      403,
    );
    expect(h.calls).not.toHaveBeenCalled();
    const login = await h.login();
    expect(
      (await h.host.exchange(h.request(undefined, login, 'GET', undefined, token))).status,
    ).toBe(303);
  });
  it('reauthorizes the real principal, keeps headers private and consumes entry only once', async () => {
    const h = harness();
    const login = await h.login();
    const token = await h.token();
    const entry = h.request(undefined, login, 'GET', undefined, token);
    const opened = await h.host.exchange(entry);
    expect(opened.status).toBe(303);
    expect(
      /; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Strict$/u.test(
        opened.headers.get('set-cookie') ?? '',
      ),
    ).toBe(true);
    expect(opened.headers.get('location')).toBe('/continuation/a/de?preview=true&locale=de');
    expect((await h.host.exchange(entry)).status).toBe(403);
    const cookie = `${login}; ${opened.headers.get('set-cookie')!.split(';')[0]}`;
    for (let i = 0; i < 2; i++) {
      const read = await h.host.load(h.request(undefined, cookie));
      expect(read.status).toBe(200);
      expect(read.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(h.calls.mock.calls.filter(([url]) => urlText(url).endsWith('/me'))).toHaveLength(4);
    h.revoke();
    const before = h.calls.mock.calls.length;
    expect((await h.host.load(h.request(undefined, cookie))).status).toBe(403);
    expect(h.calls.mock.calls.length - before).toBe(1);
  });
  it.each([
    { path: '/continuation/b/de?preview=true&locale=de' },
    { path: '/continuation/a/de?preview=true&locale=en' },
    { path: '/continuation/a/de?preview=true&locale=de&depth=4' },
  ])('refuses manipulated target $path before reading content', async ({ path }) => {
    const h = harness();
    const login = await h.login();
    const opened = await h.host.exchange(
      h.request(undefined, login, 'GET', undefined, await h.token()),
    );
    const cookie = `${login}; ${opened.headers.get('set-cookie')!.split(';')[0]}`;
    const before = h.calls.mock.calls.filter(([url]) => urlText(url).includes('/articles/')).length;
    expect((await h.host.load(h.request(path, cookie))).status).toBeGreaterThanOrEqual(400);
    expect(h.calls.mock.calls.filter(([url]) => urlText(url).includes('/articles/'))).toHaveLength(
      before,
    );
  });
  it('logs out upstream and refuses replay of the old browser cookies locally', async () => {
    const h = harness();
    const login = await h.login();
    const opened = await h.host.exchange(
      h.request(undefined, login, 'GET', undefined, await h.token()),
    );
    const cookie = `${login}; ${opened.headers.get('set-cookie')!.split(';')[0]}`;
    expect((await h.host.logout(h.request('/logout', cookie, 'POST'))).status).toBe(204);
    h.calls.mockClear();
    expect((await h.host.load(h.request(undefined, cookie))).status).toBe(403);
    expect(h.calls).not.toHaveBeenCalled();
  });
  it('expires host state without trusting a remaining browser cookie', async () => {
    const h = harness();
    const login = await h.login();
    h.advance();
    h.calls.mockClear();
    expect((await h.host.load(h.request(undefined, login))).status).toBe(403);
    expect(h.calls).not.toHaveBeenCalled();
  });
  it('rejects authority fields and cross-origin login before upstream work', async () => {
    const h = harness();
    expect(
      (
        await h.host.login(
          h.request('/login', '', 'POST', { email: 'a', password: 'b', subject: '1' }),
        )
      ).status,
    ).toBe(400);
    const foreign = h.request('/login', '', 'POST', { email: 'a', password: 'b' });
    foreign.headers.set('origin', 'https://foreign.invalid');
    expect((await h.host.login(foreign)).status).toBe(403);
    expect(h.calls).not.toHaveBeenCalled();
  });
  it.each([
    { body: { token: 'synthetic', exp: 0, user: { id: 1, editor: 'a' } } },
    { body: { token: 'synthetic', exp: 9_999_999_999, user: { id: 2, editor: 'a' } } },
    { body: { token: 'synthetic', exp: 9_999_999_999, user: { id: 1, editor: 'admin' } } },
    { body: { exp: 9_999_999_999, user: { id: 1, editor: 'a' } } },
    { body: { errors: ['Unidentified login response'] } },
  ])('refuses incomplete or mismatched login claims %#', async ({ body }) => {
    const h = harness();
    h.calls.mockResolvedValueOnce(Response.json(body));
    const response = await h.host.login(
      h.request('/login', '', 'POST', { email: 'a', password: 'b' }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('bounds the login request bytes before contacting Payload', async () => {
    const h = harness();
    expect(
      (
        await h.host.login(
          h.request('/login', '', 'POST', { email: 'a', password: '界'.repeat(400) }),
        )
      ).status,
    ).toBe(403);
    expect(h.calls).not.toHaveBeenCalled();
  });
  it('bounds retained logins and does not forward further login attempts at capacity', async () => {
    const h = harness();
    for (let i = 0; i < 32; i++) await h.login();
    h.calls.mockClear();
    expect(
      (await h.host.login(h.request('/login', '', 'POST', { email: 'a', password: 'b' }))).status,
    ).toBe(503);
    expect(h.calls).not.toHaveBeenCalled();
    h.advance();
    await h.login();
  });
});
