/**
 * Plain HTML owns escaping and dispatch, but must reuse real host authorization.
 * These synthetic-upstream contracts precede the independent clean archive,
 * Node service and real Payload/browser journeys.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { issuePreviewToken } from '@/server/index';
import { createHTMLHostReference } from '../../fixtures/preview-html-host';

const ORIGIN = 'https://localhost:4288';
const PAGE = '/continuation/a/de?preview=true&locale=de';
const urlOf = (input: RequestInfo | URL): URL =>
  new URL(input instanceof Request ? input.url : String(input));

function harness(enabled = true, render?: (view: unknown) => string | Promise<string>) {
  const now = Date.now();
  const secret = randomBytes(48).toString('base64url');
  const credential = randomBytes(32).toString('base64url');
  const title = '<img src=x onerror="alert(1)"> & private';
  const upstream = vi.fn<typeof fetch>().mockImplementation((input, init) => {
    const url = urlOf(input);
    if (url.pathname.endsWith('/login')) {
      return Promise.resolve(
        Response.json({
          token: credential,
          exp: Math.floor(now / 1000) + 300,
          user: { id: 1, editor: 'a' },
        }),
      );
    }
    expect(new Headers(init?.headers).get('authorization') === 'JWT ' + credential).toBe(true);
    if (url.pathname.endsWith('/me')) {
      return Promise.resolve(
        Response.json({
          exp: Math.floor(now / 1000) + 300,
          user: { id: 1, editor: 'a' },
        }),
      );
    }
    return Promise.resolve(
      Response.json({
        id: 3,
        title,
        related: [{ title: '<svg onload="bad">' }],
        files: [9],
      }),
    );
  });
  const handle = createHTMLHostReference(
    {
      enabled,
      audience: ORIGIN,
      secret,
      serverURL: 'http://127.0.0.1:1234',
      ids: { 'user-a': '1', 'user-b': '2', 'article-a': '3', 'article-b': '4' },
      fetch: upstream,
      now: () => now,
    },
    render,
  );
  const request = (
    path = PAGE,
    cookie = '',
    method = 'GET',
    data?: unknown,
    extra: Record<string, string> = {},
  ) =>
    new Request(ORIGIN + path, {
      method,
      headers: {
        host: new URL(ORIGIN).host,
        'x-forwarded-proto': 'https',
        origin: ORIGIN,
        cookie,
        ...(data ? { 'content-type': 'application/json' } : {}),
        ...extra,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  const enter = async () => {
    const login = await handle(
      request('/continuation/login', '', 'POST', {
        email: 'a@fixture.invalid',
        password: 'only a local fixture',
      }),
    );
    expect(login.status).toBe(204);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const token = await issuePreviewToken(
      {
        audience: ORIGIN,
        path: '/continuation/a/de',
        locale: 'de',
        subject: '1',
      },
      { secret, now: () => now },
    );
    const exchanged = await handle(
      request('/continuation/a/de/entry?preview=true&locale=de', cookie, 'GET', undefined, {
        'x-preview-token': token,
      }),
    );
    expect(exchanged.status).toBe(303);
    expect(exchanged.headers.get('location')).toBe(PAGE);
    return cookie + '; ' + exchanged.headers.get('set-cookie')!.split(';')[0]!;
  };
  return { handle, upstream, request, enter, title, credential };
}

describe('plain HTML host reference', () => {
  it('passes only the authorized page view to an asynchronous native renderer', async () => {
    const render = vi.fn().mockResolvedValue('<main>Native renderer</main>');
    const h = harness(true, render);
    await h.handle(h.request('/'));
    await h.handle(h.request());
    expect(render).not.toHaveBeenCalled();
    const cookie = await h.enter();
    h.upstream.mockClear();
    const response = await h.handle(h.request(PAGE, cookie));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<main>Native renderer</main>');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(render).toHaveBeenCalledOnce();
    const view = render.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual(['initialData', 'locale', 'origin', 'path']);
    expect(view).toMatchObject({
      initialData: { id: 3, title: h.title },
      locale: 'de',
      origin: ORIGIN,
      path: '/continuation/a/de',
    });
    expect(JSON.stringify(view).includes(h.credential)).toBe(false);
    expect(h.upstream).toHaveBeenCalledTimes(2);
  });

  it('does not call a renderer after a failed private read', async () => {
    const render = vi.fn().mockResolvedValue('<main>Must not render</main>');
    const h = harness(true, render);
    const cookie = await h.enter();
    h.upstream.mockResolvedValueOnce(
      Response.json({
        exp: Math.floor(Date.now() / 1000) + 300,
        user: { id: 1, editor: 'a' },
      }),
    );
    h.upstream.mockResolvedValueOnce(
      Response.json({ message: 'private failure' }, { status: 503 }),
    );
    const response = await h.handle(h.request(PAGE, cookie));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private failure');
    expect(render).not.toHaveBeenCalled();
  });

  it('refuses native rendering failures without returning their details or client state', async () => {
    const render = vi.fn().mockRejectedValue(new Error('private render failure'));
    const h = harness(true, render);
    const cookie = await h.enter();
    const response = await h.handle(h.request(PAGE, cookie));
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain('Preview unavailable');
    expect(body).not.toContain('private render failure');
    expect(body.includes(h.credential)).toBe(false);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(render).toHaveBeenCalledOnce();
  });

  it('keeps the public shell free of preview runtime, data and authenticated reads', async () => {
    const h = harness();
    const response = await h.handle(h.request('/'));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('id="preview"');
    expect(html).not.toContain('payload-live-preview');
    expect(html).not.toContain('<script');
    expect(h.upstream).not.toHaveBeenCalled();
  });

  it('refuses disabled or anonymous preview without a private upstream request', async () => {
    for (const enabled of [false, true]) {
      const h = harness(enabled);
      const response = await h.handle(h.request());
      expect(response.status).toBe(403);
      expect(await response.text()).toContain('Preview unavailable');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('vary')).toBe('Cookie');
      expect(h.upstream).not.toHaveBeenCalled();
    }
  });

  it('renders one authorized read as escaped HTML with public client scope only', async () => {
    const h = harness();
    const cookie = await h.enter();
    h.upstream.mockClear();
    const response = await h.handle(h.request(PAGE, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain('frame-ancestors ' + ORIGIN);
    const html = await response.text();
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; private');
    expect(html).toContain('&lt;svg onload=&quot;bad&quot;&gt;');
    expect(html).not.toContain(h.title);
    expect(html.includes(h.credential)).toBe(false);
    expect(html).not.toContain('payloadHeaders');
    expect(html).not.toContain('authorization');
    expect(html).toContain('type="module" src="/preview.js"');
    expect(
      h.upstream.mock.calls.filter(([input]) => urlOf(input).pathname.endsWith('/me')),
    ).toHaveLength(1);
    expect(
      h.upstream.mock.calls.filter(([input]) => urlOf(input).pathname.startsWith('/api/articles/')),
    ).toHaveLength(1);
  });

  it('retains exact query, user, locale and method checks before private reads', async () => {
    const h = harness();
    const cookie = await h.enter();
    h.upstream.mockClear();
    for (const [path, method, status] of [
      [PAGE + '&depth=9', 'GET', 400],
      ['/continuation/b/de/data?preview=true&locale=de', 'GET', 403],
      ['/continuation/a/de/data?preview=true&locale=en', 'GET', 403],
      [PAGE, 'POST', 405],
      ['/continuation/login', 'GET', 405],
    ] as const) {
      expect((await h.handle(h.request(path, cookie, method))).status).toBe(status);
    }
    expect(
      h.upstream.mock.calls.filter(([input]) => urlOf(input).pathname.startsWith('/api/articles/')),
    ).toHaveLength(0);
  });

  it('does not promote an arbitrary forwarded host, protocol or request origin', async () => {
    const h = harness();
    const cookie = await h.enter();
    h.upstream.mockClear();
    for (const headers of [
      { host: 'foreign.invalid' },
      { 'x-forwarded-proto': 'http' },
      { origin: 'https://foreign.invalid' },
    ]) {
      expect((await h.handle(h.request(PAGE, cookie, 'GET', undefined, headers))).status).toBe(403);
    }
    expect(h.upstream).not.toHaveBeenCalled();
  });

  it('withholds upstream failure details and never turns a failed read into rendered data', async () => {
    const h = harness();
    const cookie = await h.enter();
    h.upstream.mockResolvedValueOnce(
      Response.json({
        exp: Math.floor(Date.now() / 1000) + 300,
        user: { id: 1, editor: 'a' },
      }),
    );
    h.upstream.mockResolvedValueOnce(
      Response.json({ message: 'private backend failure' }, { status: 503 }),
    );
    const response = await h.handle(h.request(PAGE, cookie));
    expect(response.status).toBe(502);
    const html = await response.text();
    expect(html).toContain('Preview unavailable');
    expect(html).not.toContain('private backend failure');
    expect(html).not.toContain('/preview.js');
    expect(html.includes(h.credential)).toBe(false);
  });
});
