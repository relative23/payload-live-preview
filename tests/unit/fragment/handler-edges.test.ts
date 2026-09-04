import { describe, expect, it, vi } from 'vitest';
import {
  createFragmentHandler,
  createFragmentStrategy,
  type FragmentBoundary,
  type StrategyRequest,
} from '@fragment/index';

/**
 * What the handler does with an answer it cannot use: a body that is not a
 * stream, one that is not JSON, one that is too large, and an environment whose
 * `location` cannot resolve the endpoint at all. Each must fail closed.
 */

const ENDPOINT = '/payload/fragment';
const LOCATION = { pathname: '/page', search: '' };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function boundary(id = 'hero'): FragmentBoundary {
  return { element: document.createElement('section'), id, key: undefined, dependsOn: [] };
}

function request(overrides: Partial<StrategyRequest> = {}): StrategyRequest {
  return {
    revision: 7,
    receivedAt: 1,
    fields: { title: 'T' },
    locale: undefined,
    collectionSlug: undefined,
    globalSlug: 'home',
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A response whose `body` is not a byte stream, so the reader path is skipped. */
function streamless(text: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json; charset=utf-8' },
    body: null,
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

describe('createFragmentStrategy — an endpoint that cannot be resolved', () => {
  it('refuses rather than trusting an endpoint it could not compare against the origin', () => {
    // A location whose href is not a URL: resolution fails, and an endpoint
    // that cannot be proven same-origin must not be used.
    vi.stubGlobal('location', { href: 'not-a-url', origin: 'http://localhost:3000' });
    try {
      expect(() => createFragmentStrategy({ endpoint: '/payload/fragment' })).toThrow(
        /same-origin path/u,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('createFragmentHandler — answers it cannot use', () => {
  it('reads a response whose body is not a stream and still renders', async () => {
    const fetchFn = vi.fn<FetchLike>(() =>
      Promise.resolve(
        streamless(
          JSON.stringify({
            html: '<h1>S</h1>',
            boundary: { id: 'hero' },
            revision: 7,
            metadata: { renderedAt: '2026-08-27T00:00:00Z', renderer: 'test' },
          }),
        ),
      ),
    );
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    expect(await handler(request(), boundary())).toMatchObject({
      status: 'rendered',
      html: '<h1>S</h1>',
    });
  });

  it('refuses a streamless response that exceeds the byte cap', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(streamless('x'.repeat(2048))));
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
      maxResponseBytes: 64,
    });
    expect(await handler(request(), boundary())).toMatchObject({ status: 'failed' });
  });

  it('reports LP0802 for a body that is not JSON', async () => {
    const fetchFn = vi.fn<FetchLike>(() => Promise.resolve(streamless('<html>nope</html>')));
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      fetch: fetchFn,
      location: LOCATION,
    });
    expect(await handler(request(), boundary())).toMatchObject({
      status: 'failed',
      code: 'LP0802',
    });
  });
});
