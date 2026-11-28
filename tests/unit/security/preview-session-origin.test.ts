/**
 * Payload refuses a server-side cookie without an `Origin` when its CSRF list is
 * set, so the strategy sends one with the cookie: the origin of `serverURL`, or
 * the one the project names. One request per check, and the same headers on an
 * actual draft read.
 */
import { describe, expect, it } from 'vitest';
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
  it('asks /me once, with the Payload origin and only the named session cookie', async () => {
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

  it('does not ask again when Payload refuses the origin the project names', async () => {
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

  it.each([
    [200, { user: null }, 'invalid'],
    [401, { user: null }, 'invalid'],
    [503, { user: null }, 'unavailable'],
    [200, { user: { id: 7 }, collection: 'other-users' }, 'invalid'],
    [200, {}, 'invalid'],
    [200, null, 'invalid'],
    [200, undefined, 'invalid'],
  ])('asks once for a %s response with body %j', async (status, body, outcome) => {
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
