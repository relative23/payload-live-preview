/**
 * Payload 3.89 refuses a server-side cookie without an `Origin` when its CSRF
 * list is set; Payload 2.32.3 can accept that request and refuse a new origin.
 * Preserve a working cookie-only session and test the bounded origin retry,
 * explicit configuration and headers passed to an actual draft read.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  authorizePreviewRequest,
  PreviewConfigurationError,
  type FetchLike,
  type PayloadSessionStrategy,
  type PreviewAuthorizationRequest,
} from '@security/preview-authorization';
import { definePreview } from '@/server/preview';

const SITE = 'https://www.example.com';
const CMS = 'https://cms.example.com';
const NOW = 1_800_000_000_000;

function request(headers: Record<string, string> = {}): PreviewAuthorizationRequest {
  return {
    url: `${SITE}/page?preview=true`,
    headers: new Headers({ cookie: 'payload-token=tok.en', ...headers }),
  };
}

function asking(seen: Record<string, string>[]): FetchLike {
  return (_input, init) => {
    seen.push(init.headers);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          user: init.headers['origin'] === undefined ? null : { id: 7 },
          collection: 'users',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
  };
}

function strategy(
  seen: Record<string, string>[],
  overrides: Partial<PayloadSessionStrategy> = {},
): PayloadSessionStrategy {
  return {
    type: 'payload-session',
    serverURL: CMS,
    fetch: asking(seen),
    now: () => NOW,
    ...overrides,
  };
}

describe('the payload-session strategy sends an origin with the cookie', () => {
  it('keeps a working Payload 2 session when only the site origin is listed', async () => {
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      request(),
      strategy(seen, {
        fetch: (_input, init) => {
          seen.push(init.headers);
          // Payload 2 accepts an absent origin even with a configured CSRF list.
          const sentOrigin = new Headers(init.headers).get('origin');
          const accepted = sentOrigin === null || sentOrigin === SITE;
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ user: accepted ? { id: 7 } : null, collection: 'users' }),
          });
        },
      }),
    );
    expect(result.authorized).toBe(true);
    expect(seen).toStrictEqual([{ accept: 'application/json', cookie: 'payload-token=tok.en' }]);
    if (!result.authorized) throw new Error('expected the existing cookie-only session');
    expect(result.context.payloadHeaders).toStrictEqual({ cookie: 'payload-token=tok.en' });
  });

  it('defaults to the Payload origin and forwards only the named session cookie', async () => {
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      request({
        cookie: 'other=private; payload-token=tok.en',
        origin: 'https://untrusted.example.com',
        authorization: 'Bearer private',
        'sec-fetch-site': 'cross-site',
      }),
      strategy(seen),
    );
    expect(result.authorized).toBe(true);
    expect(seen).toStrictEqual([
      {
        accept: 'application/json',
        cookie: 'payload-token=tok.en',
      },
      {
        accept: 'application/json',
        cookie: 'payload-token=tok.en',
        origin: CMS,
      },
    ]);
  });

  it.each([
    ['https://CMS.example.com/', CMS],
    ['https://cms.example.com/some/path?q=1', CMS],
    ['https://cms.example.com:443', CMS],
    ['http://localhost:3001/admin', 'http://localhost:3001'],
  ])('reads the origin of serverURL %s as %s', async (serverURL, origin) => {
    const seen: Record<string, string>[] = [];
    await authorizePreviewRequest(request(), strategy(seen, { serverURL }));
    expect(seen.at(-1)?.['origin']).toBe(origin);
  });

  it('sends the origin the project names when Payload’s csrf list holds that one', async () => {
    const seen: Record<string, string>[] = [];
    await authorizePreviewRequest(request(), strategy(seen, { origin: `${SITE}/ignored/path` }));
    expect(seen[0]?.['origin']).toBe(SITE);
  });

  it.each(['not a url', 'ftp://www.example.com', '', '/relative'])(
    'refuses an origin that is not an absolute http(s) URL: %j',
    async (origin) => {
      await expect(authorizePreviewRequest(request(), strategy([], { origin }))).rejects.toThrow(
        PreviewConfigurationError,
      );
      await expect(authorizePreviewRequest(request(), strategy([], { origin }))).rejects.toThrow(
        /origin/u,
      );
    },
  );

  it('hands the draft read the same origin with the cookie, and nothing more', async () => {
    const result = await authorizePreviewRequest(request(), strategy([]));
    if (!result.authorized) throw new Error('expected an authorized preview');
    expect(result.context.payloadHeaders).toEqual({
      cookie: 'payload-token=tok.en',
      origin: CMS,
    });
    const named = await authorizePreviewRequest(request(), strategy([], { origin: SITE }));
    if (!named.authorized) throw new Error('expected an authorized preview');
    expect(named.context.payloadHeaders).toEqual({ cookie: 'payload-token=tok.en', origin: SITE });
  });

  it.each([undefined, SITE])(
    'forwards the verified origin %s on an actual draft read',
    async (origin) => {
      const result = await authorizePreviewRequest(
        request(),
        strategy([], origin === undefined ? {} : { origin }),
      );
      if (!result.authorized) throw new Error('expected an authorized preview');
      const seen: Record<string, string>[] = [];
      const preview = definePreview({
        serverURL: CMS,
        depth: 0,
        fetch: (_input, init) => {
          seen.push(init.headers);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ title: 'Draft title' }),
          });
        },
      });
      const read = await preview.fetchGlobal<{ title: string }>({
        global: 'homepage',
        authorization: result.context,
        headers: { origin: 'https://untrusted.example.com', cookie: 'payload-token=stale' },
      });
      expect(read).toMatchObject({ ok: true, draft: true, data: { title: 'Draft title' } });
      expect(seen[0]).toEqual({
        accept: 'application/json',
        cookie: 'payload-token=tok.en',
        origin: origin ?? CMS,
      });
    },
  );

  it('still sends no request when there is no cookie to forward', async () => {
    const seen: Record<string, string>[] = [];
    const bare: PreviewAuthorizationRequest = {
      url: `${SITE}/`,
      headers: { get: () => null },
    };
    const result = await authorizePreviewRequest(bare, strategy(seen));
    expect(result.outcome).toBe('missing-credential');
    expect(seen).toEqual([]);
  });

  it('stops after one origin retry when Payload still reports no user', async () => {
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      request(),
      strategy(seen, {
        fetch: (_input, init) => {
          seen.push(init.headers);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ user: null }),
          });
        },
      }),
    );
    expect(result.outcome).toBe('invalid');
    expect(seen).toHaveLength(2);
  });

  it('does not retry an explicit origin that Payload refuses', async () => {
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      request(),
      strategy(seen, {
        origin: SITE,
        fetch: (_input, init) => {
          seen.push(init.headers);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ user: null }),
          });
        },
      }),
    );
    expect(result.outcome).toBe('invalid');
    expect(seen).toEqual([
      { accept: 'application/json', cookie: 'payload-token=tok.en', origin: SITE },
    ]);
  });

  it('keeps the original timeout budget across the origin retry', async () => {
    vi.useFakeTimers();
    try {
      const seen: Record<string, string>[] = [];
      let settled = false;
      const pending = authorizePreviewRequest(
        request(),
        strategy(seen, {
          timeoutMs: 250,
          fetch: (_input, init) => {
            seen.push(init.headers);
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                resolve({
                  ok: true,
                  status: 200,
                  json: () => Promise.resolve({ user: seen.length === 1 ? null : { id: 7 } }),
                });
              }, 200);
              init.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer);
                  reject(new Error('aborted'));
                },
                { once: true },
              );
            });
          },
        }),
      ).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(250);
      expect(seen).toHaveLength(2);
      expect(settled).toBe(true);
      expect((await pending).outcome).toBe('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a user returned after the caller aborts the origin retry', async () => {
    const controller = new AbortController();
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      { ...request(), signal: controller.signal },
      strategy(seen, {
        fetch: (_input, init) => {
          seen.push(init.headers);
          if (seen.length === 2) controller.abort();
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ user: seen.length === 1 ? null : { id: 7 } }),
          });
        },
      }),
    );
    expect(result.outcome).toBe('unavailable');
    expect(seen).toHaveLength(2);
  });

  it.each([
    [401, { user: null }, 'invalid'],
    [503, { user: null }, 'unavailable'],
    [200, { user: { id: 7 }, collection: 'other-users' }, 'invalid'],
    [200, {}, 'invalid'],
    [200, null, 'invalid'],
    [200, undefined, 'invalid'],
  ])('does not retry a %s response with body %j', async (status, body, outcome) => {
    const seen: Record<string, string>[] = [];
    const result = await authorizePreviewRequest(
      request(),
      strategy(seen, {
        fetch: (_input, init) => {
          seen.push(init.headers);
          return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
        },
      }),
    );
    expect(result.outcome).toBe(outcome);
    expect(seen).toHaveLength(1);
  });
});
