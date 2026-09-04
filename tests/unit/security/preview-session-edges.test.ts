import { describe, expect, it } from 'vitest';
import {
  authorizePreviewRequest,
  PreviewConfigurationError,
  type FetchLike,
  type PayloadSessionStrategy,
  type PreviewAuthorizationRequest,
} from '@security/preview-authorization';

/**
 * What `/me` may answer and what a `serverURL` may be. A session verdict that
 * accepts the wrong shape hands an unauthenticated visitor a preview, so every
 * shape that is not a user of the configured collection has to refuse.
 */

const SITE = 'https://www.example.com';
const CMS = 'https://cms.example.com';
const NOW = 1_800_000_000_000;

function request(cookie?: string): PreviewAuthorizationRequest {
  const headers = new Map(cookie === undefined ? [] : [['cookie', cookie]]);
  return {
    url: `${SITE}/page`,
    headers: { get: (name) => headers.get(name.toLowerCase()) ?? null },
  };
}

function strategyWith(body: unknown, overrides: Partial<PayloadSessionStrategy> = {}) {
  const fetch: FetchLike = () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  return {
    type: 'payload-session' as const,
    serverURL: CMS,
    fetch,
    now: () => NOW,
    ...overrides,
  };
}

describe('payload-session serverURL validation', () => {
  it('refuses a serverURL that is not http(s)', async () => {
    await expect(
      authorizePreviewRequest(
        request('payload-token=abc'),
        strategyWith({}, { serverURL: 'ftp://cms.example.com' }),
      ),
    ).rejects.toThrow(PreviewConfigurationError);
  });

  it('refuses a serverURL that is not absolute', async () => {
    await expect(
      authorizePreviewRequest(
        request('payload-token=abc'),
        strategyWith({}, { serverURL: '/api' }),
      ),
    ).rejects.toThrow(PreviewConfigurationError);
  });
});

describe('payload-session /me answers', () => {
  async function outcome(body: unknown, overrides: Partial<PayloadSessionStrategy> = {}) {
    const result = await authorizePreviewRequest(
      request('payload-token=abc'),
      strategyWith(body, overrides),
    );
    return result.outcome;
  }

  it('accepts a numeric user id, which Payload sends for a Postgres adapter', async () => {
    expect(await outcome({ user: { id: 42, exp: NOW / 1000 + 600 } })).toBe('authorized');
  });

  it('refuses an id that is neither a non-empty string nor a finite number', async () => {
    // The cookie was there, so this is a bad answer rather than a missing credential.
    expect(await outcome({ user: { id: '' } })).toBe('invalid');
    expect(await outcome({ user: { id: Number.NaN } })).toBe('invalid');
    expect(await outcome({ user: { id: {} } })).toBe('invalid');
    expect(await outcome({ user: {} })).toBe('invalid');
  });

  it('refuses a body that is not an object describing a user', async () => {
    expect(await outcome(null)).toBe('invalid');
    expect(await outcome([{ user: { id: 'a' } }])).toBe('invalid');
    expect(await outcome({ user: null })).toBe('invalid');
    expect(await outcome({ user: ['a'] })).toBe('invalid');
  });

  it('refuses a user from another auth collection, which /me also answers for', async () => {
    expect(await outcome({ collection: 'customers', user: { id: 'a' } })).toBe('invalid');
    expect(await outcome({ user: { id: 'a', collection: 'customers' } })).toBe('invalid');
  });

  it('accepts the configured collection when the body names it', async () => {
    expect(
      await outcome(
        { collection: 'staff', user: { id: 'a', exp: NOW / 1000 + 600 } },
        { usersSlug: 'staff' },
      ),
    ).toBe('authorized');
  });
});

describe('payload-session cookie extraction', () => {
  async function outcome(cookie?: string) {
    const result = await authorizePreviewRequest(
      request(cookie),
      strategyWith({ user: { id: 'a', exp: NOW / 1000 + 600 } }),
    );
    return result.outcome;
  }

  it('needs exactly one cookie of that name', async () => {
    expect(await outcome()).toBe('missing-credential');
    expect(await outcome('')).toBe('missing-credential');
    expect(await outcome('payload-token=a; payload-token=b')).toBe('missing-credential');
    expect(await outcome('other=a')).toBe('missing-credential');
  });

  it('refuses a value that is not shaped like a token', async () => {
    // Anything outside the JWT alphabet could smuggle a second header.
    expect(await outcome('payload-token=')).toBe('missing-credential');
    expect(await outcome('payload-token=a b')).toBe('missing-credential');
    expect(await outcome('payload-token=a\nb')).toBe('missing-credential');
  });

  it('refuses a value longer than the configured maximum', async () => {
    const long = 'a'.repeat(5000);
    const result = await authorizePreviewRequest(
      request(`payload-token=${long}`),
      strategyWith({ user: { id: 'a' } }),
    );
    expect(result.outcome).toBe('missing-credential');
  });
});
