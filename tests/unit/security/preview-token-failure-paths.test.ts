import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  authorizePreviewRequest,
  issuePreviewToken,
  type PreviewAuthorizationRequest,
  type PreviewTokenReplayStore,
  type SignedTokenStrategy,
  type SubtleCryptoLike,
} from '@security/preview-authorization';

/**
 * The refusal arms a valid token never reaches: no Web Crypto, an unparseable
 * request URL, a payload that survives the signature but not the parse, and a
 * replay store that fails. Each one must refuse — a token path that throws or
 * falls through would authorize on an error.
 */

const crypto = webcrypto as unknown as SubtleCryptoLike;
const SITE = 'https://www.example.com';
const SECRET = 'a-secret-that-is-at-least-thirty-two-bytes-long';
const NOW = 1_800_000_000_000;

const strategy: SignedTokenStrategy = {
  type: 'signed-token',
  secret: SECRET,
  audience: SITE,
  crypto,
  now: () => NOW,
};

function request(url: string, headers: Record<string, string> = {}): PreviewAuthorizationRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { url, headers: { get: (name) => map.get(name.toLowerCase()) ?? null } };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mint a correctly signed token around an arbitrary payload, valid signature and all. */
async function signedAround(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const body = base64Url(encoder.encode(payload));
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const signature = await webcrypto.subtle.sign('HMAC', key, encoder.encode(`v1.${body}`));
  return `v1.${body}.${base64Url(new Uint8Array(signature))}`;
}

describe('signed tokens without a Web Crypto implementation', () => {
  it('refuses to sign rather than emitting an unsigned token', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      await expect(issuePreviewToken({ audience: SITE }, { secret: SECRET })).rejects.toThrow(
        /no Web Crypto implementation/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses to authorize instead of skipping verification', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const token = await issuePreviewToken(
        { audience: SITE },
        { secret: SECRET, crypto, now: () => NOW },
      );
      const { crypto: _unused, ...withoutCrypto } = strategy;
      const result = await authorizePreviewRequest(
        request(`${SITE}/page?previewToken=${token}`),
        withoutCrypto,
      );
      expect(result).toEqual({ authorized: false, outcome: 'unavailable', context: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('ignores a `crypto` global that carries no subtle', async () => {
    vi.stubGlobal('crypto', { getRandomValues: () => undefined });
    try {
      await expect(issuePreviewToken({ audience: SITE }, { secret: SECRET })).rejects.toThrow(
        /no Web Crypto implementation/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('signed tokens on a request the runtime cannot parse', () => {
  it('finds no query token in an unparseable URL and reports the credential missing', async () => {
    const result = await authorizePreviewRequest(request('not-an-absolute-url'), strategy);
    expect(result.outcome).toBe('missing-credential');
  });

  it('refuses a path-bound token when the URL cannot be parsed for comparison', async () => {
    // The header transport gets the token in regardless of the URL, so the
    // path check is the first thing that has to read it.
    const token = await issuePreviewToken(
      { audience: SITE, path: '/page' },
      { secret: SECRET, crypto, now: () => NOW },
    );
    const result = await authorizePreviewRequest(
      request('not-an-absolute-url', { 'x-preview-token': token }),
      { ...strategy, transport: { kind: 'header' } },
    );
    expect(result.outcome).toBe('invalid');
  });
});

describe('signed tokens whose payload survives the signature but not the parse', () => {
  it('refuses base64url that is not decodable', async () => {
    // Charset-valid but a length no base64 padding can rescue.
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=v1.A.${'a'.repeat(43)}`),
      strategy,
    );
    expect(result.outcome).toBe('invalid');
  });

  it('refuses a correctly signed payload that is not JSON', async () => {
    const token = await signedAround('not json at all');
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${token}`),
      strategy,
    );
    expect(result.outcome).toBe('invalid');
  });

  it('refuses a correctly signed payload that is JSON but not an object', async () => {
    const token = await signedAround('"a string"');
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${token}`),
      strategy,
    );
    expect(result.outcome).toBe('invalid');
  });

  it('refuses claims of the wrong shape, one field at a time', async () => {
    const valid = {
      v: 1,
      aud: SITE,
      pur: 'live-preview',
      iat: NOW,
      exp: NOW + 60_000,
      jti: 'id',
    };
    const broken: readonly Record<string, unknown>[] = [
      { ...valid, v: 2 },
      { ...valid, aud: 1 },
      { ...valid, pur: null },
      { ...valid, iat: '0' },
      { ...valid, exp: '0' },
      { ...valid, jti: 7 },
      { ...valid, pth: 5 },
      { ...valid, loc: 5 },
      { ...valid, sub: 5 },
    ];
    for (const claims of broken) {
      const token = await signedAround(JSON.stringify(claims));
      const result = await authorizePreviewRequest(
        request(`${SITE}/page?previewToken=${token}`),
        strategy,
      );
      expect(result.outcome, JSON.stringify(claims)).toBe('invalid');
    }
  });

  it('accepts the same claims once they are well formed', async () => {
    const token = await signedAround(
      JSON.stringify({
        v: 1,
        aud: SITE,
        pur: 'live-preview',
        iat: NOW,
        exp: NOW + 60_000,
        jti: 'id',
      }),
    );
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${token}`),
      strategy,
    );
    expect(result.authorized).toBe(true);
  });
});

describe('signed tokens at the edges of the accepted input', () => {
  it('accepts a raw-bytes secret as the equal of the same string', async () => {
    const bytes = new TextEncoder().encode(SECRET);
    const token = await issuePreviewToken(
      { audience: SITE },
      { secret: bytes, crypto, now: () => NOW },
    );
    const result = await authorizePreviewRequest(request(`${SITE}/page?previewToken=${token}`), {
      ...strategy,
      secret: bytes,
    });
    expect(result.authorized).toBe(true);
  });

  it('refuses an oversized token before spending a signature verification on it', async () => {
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=v1.${'a'.repeat(5000)}.b`),
      strategy,
    );
    expect(result.outcome).toBe('invalid');
  });

  it('refuses a repeated token parameter rather than picking one', async () => {
    const token = await issuePreviewToken(
      { audience: SITE },
      { secret: SECRET, crypto, now: () => NOW },
    );
    const result = await authorizePreviewRequest(
      request(`${SITE}/page?previewToken=${token}&previewToken=${token}`),
      strategy,
    );
    expect(result.outcome).toBe('missing-credential');
  });
});

describe('signed tokens against a failing replay store', () => {
  async function authorizeWith(replay: PreviewTokenReplayStore): Promise<string> {
    const token = await issuePreviewToken(
      { audience: SITE },
      { secret: SECRET, crypto, now: () => NOW },
    );
    const result = await authorizePreviewRequest(request(`${SITE}/page?previewToken=${token}`), {
      ...strategy,
      replay,
    });
    return result.outcome;
  }

  it('refuses as unavailable when the lookup throws, never as authorized', async () => {
    expect(
      await authorizeWith({
        isUsed: () => Promise.reject(new Error('store down')),
        markUsed: () => Promise.resolve(),
      }),
    ).toBe('unavailable');
  });

  it('refuses as unavailable when recording the use throws', async () => {
    // Recording is what makes the token single-use; if it cannot be recorded,
    // authorizing would hand out a token that can be replayed.
    expect(
      await authorizeWith({
        isUsed: () => Promise.resolve(false),
        markUsed: () => Promise.reject(new Error('store down')),
      }),
    ).toBe('unavailable');
  });

  it('still refuses a token the store already knows', async () => {
    expect(
      await authorizeWith({
        isUsed: () => Promise.resolve(true),
        markUsed: () => Promise.resolve(),
      }),
    ).toBe('replayed');
  });
});
