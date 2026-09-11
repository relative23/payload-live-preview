/**
 * The request `DataMerger` sends: its method, headers and credentials, and
 * where the `fetch` it uses comes from.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataMerger } from '@core/data-merger';
import { jsonResponse } from './data-merger-harness';

describe('the one request that carries cookies', () => {
  /**
   * The merge is a POST — the form values travel in the body — that the server
   * must read as a GET: without `X-Payload-HTTP-Method-Override: GET` the same
   * request, with the same cookies, would write the document instead of
   * returning it populated. Both endpoints carry the header, and nothing else.
   */
  it.each([
    [
      'a collection document',
      { collectionSlug: 'posts', data: { id: '42', title: 'raw' } },
      'https://cms.example.com/api/posts/42',
    ],
    [
      'a global',
      { globalSlug: 'homepage', data: { title: 'raw' } },
      'https://cms.example.com/api/globals/homepage',
    ],
  ])(
    'reads %s with a POST the server treats as a GET, declared as JSON',
    async (_case, request, expectedUrl) => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
      const merger = new DataMerger({ serverURL: 'https://cms.example.com', fetchFn });

      await merger.merge(request);

      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, init] = fetchFn.mock.calls[0] ?? [];
      expect(url).toBe(expectedUrl);
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('include');
      expect(init?.headers).toEqual({
        'Content-Type': 'application/json',
        'X-Payload-HTTP-Method-Override': 'GET',
      });
    },
  );
});

describe('without an injected fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('sends the same request through the global fetch', async () => {
    const globalFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ title: 'global' }));
    vi.stubGlobal('fetch', globalFetch);
    const merger = new DataMerger({ serverURL: 'https://cms.example.com' });

    await expect(merger.merge({ collectionSlug: 'posts', data: { id: '42' } })).resolves.toEqual({
      status: 'merged',
      doc: { title: 'global' },
    });

    expect(globalFetch).toHaveBeenCalledOnce();
    const [url, init] = globalFetch.mock.calls[0] ?? [];
    expect(url).toBe('https://cms.example.com/api/posts/42');
    expect(init?.credentials).toBe('include');
    expect(init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-Payload-HTTP-Method-Override': 'GET',
    });
  });
  it('falls back to the raw values quietly when no fetch exists at all: no request, no diagnostic', async () => {
    // Absent, not `undefined`: a bare `fetch` reference must not be evaluated
    // when the typeof check says there is none, or it throws ReferenceError
    // and the fallback arrives as an exception with a diagnostic attached.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    Reflect.deleteProperty(globalThis, 'fetch');
    const log = vi.fn();
    try {
      const merger = new DataMerger({ serverURL: 'https://cms.example.com', log });
      await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
        status: 'unavailable',
      });
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, 'fetch', descriptor);
    }
    expect(log).not.toHaveBeenCalled();
  });
});
