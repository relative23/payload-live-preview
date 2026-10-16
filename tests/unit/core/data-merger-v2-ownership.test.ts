/**
 * Legacy reads keep the request and its diagnostics with the accepted attempt.
 * These caller seams use the real planner and body reader, without replacing either module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest } from '@core/data-merger';
import { parseFieldSchema } from '@schema/parser';
import { populationURL } from '../../helpers/population';

const SERVER = 'https://cms.example.com';
const schema = parseFieldSchema([{ name: 'author', type: 'relationship', relationTo: 'authors' }]);
const request = (author = 'A'): MergeRequest => ({ schema, data: { author } });
const response = (id = 'B'): Response =>
  new Response(JSON.stringify({ docs: [{ id, name: `Name ${id}` }] }));
const mergedB = { status: 'merged', doc: { author: { id: 'B', name: 'Name B' } } };
afterEach(() => vi.unstubAllGlobals());

describe('v2 native fetch selection', () => {
  it('accepts a valid schema without a document target and without making a request', () => {
    const fetchFn = vi.fn<typeof fetch>();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      expect(merger.canMerge(request())).toBe(true);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('returns unavailable quietly when no native fetch can read a required reference', async () => {
    vi.stubGlobal('fetch', undefined);
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'unavailable' });
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('uses native fetch with the accepted locale, depth and cookie-bearing GET contract', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A'));
    vi.stubGlobal('fetch', fetchFn);
    const merger = new DataMerger({ serverURL: SERVER, apiRoute: '/cms', depth: 2 });
    const input = { ...request(), locale: 'fr' };
    try {
      await expect(merger.merge(input)).resolves.toEqual({
        status: 'merged',
        doc: { author: { id: 'A', name: 'Name A' } },
      });
      expect(fetchFn).toHaveBeenCalledOnce();
      const [url, init] = fetchFn.mock.calls[0] ?? [];
      expect(populationURL(url).origin).toBe(SERVER);
      expect(populationURL(url).pathname).toBe('/cms/authors');
      expect(populationURL(url).searchParams.get('where[id][in]')).toBe('A');
      expect(populationURL(url).searchParams.get('locale')).toBe('fr');
      expect(populationURL(url).searchParams.get('depth')).toBe('2');
      expect(init?.method).toBe('GET');
      expect(init?.credentials).toBe('include');
      expect(init?.redirect).toBe('error');
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).has('X-Payload-HTTP-Method-Override')).toBe(false);
      expect(input.data).toEqual({ author: 'A' });
    } finally {
      merger.destroy();
    }
  });
});

describe('v2 successful accessor ownership', () => {
  it.each(['replace', 'destroy'] as const)(
    'drops a completed old plan when its data getter chooses %s',
    async (action) => {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response());
      const log = vi.fn();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      let newer: Promise<unknown> | undefined;
      const data = {
        get author() {
          if (action === 'replace') newer = merger.merge(request('B'));
          else merger.destroy();
          return 'A';
        },
      };
      try {
        await expect(merger.merge({ schema, data })).resolves.toEqual({ status: 'superseded' });
        if (action === 'replace') await expect(newer).resolves.toEqual(mergedB);
        expect(
          fetchFn.mock.calls.map(([url]) => populationURL(url).searchParams.get('where[id][in]')),
        ).toEqual(action === 'replace' ? ['B'] : []);
        expect(log).not.toHaveBeenCalled();
      } finally {
        merger.destroy();
      }
    },
  );

  it('does not dispatch an old plan after the native fetch getter accepts a newer request', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response());
    const merger = new DataMerger({ serverURL: SERVER });
    let accepted = false;
    let newer: Promise<unknown> | undefined;
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      get() {
        if (!accepted) {
          accepted = true;
          newer = merger.merge(request('B'));
        }
        return fetchFn;
      },
    });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedB);
      expect(
        fetchFn.mock.calls.map(([url]) => populationURL(url).searchParams.get('where[id][in]')),
      ).toEqual(['B']);
    } finally {
      merger.destroy();
      if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor);
      else Reflect.deleteProperty(globalThis, 'fetch');
    }
  });

  it.each(['ok-true', 'ok-false', 'status'] as const)(
    'does not consume or diagnose an old response after its %s getter accepts another request',
    async (accessor) => {
      let newer: Promise<unknown> | undefined;
      const json = vi.fn();
      const old = {
        get ok() {
          if (accessor !== 'status') newer = merger.merge(request('B'));
          return accessor === 'ok-true';
        },
        get status() {
          newer = merger.merge(request('B'));
          return 403;
        },
        json,
      } as unknown as Response;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(old)
        .mockResolvedValueOnce(response());
      const log = vi.fn();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      try {
        await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
        await expect(newer).resolves.toEqual(mergedB);
        expect(json).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
      } finally {
        merger.destroy();
      }
    },
  );

  it('drops a filled old population before another collection can be read', async () => {
    let newer: Promise<unknown> | undefined;
    const body = {
      docs: [
        {
          get id() {
            newer = merger.merge(request('B'));
            return 'A';
          },
          name: 'Old author',
        },
      ],
    };
    const old = { ok: true, body: null, json: () => Promise.resolve(body) } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response());
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    const fields = parseFieldSchema([
      { name: 'author', type: 'relationship', relationTo: 'authors' },
      { name: 'asset', type: 'upload', relationTo: 'media' },
    ]);
    const data = { author: 'A', asset: 'M' };
    try {
      await expect(merger.merge({ schema: fields, data })).resolves.toEqual({
        status: 'superseded',
      });
      await expect(newer).resolves.toEqual(mergedB);
      expect(fetchFn.mock.calls.map(([url]) => populationURL(url).pathname)).toEqual([
        '/api/authors',
        '/api/authors',
      ]);
      expect(data).toEqual({ author: 'A', asset: 'M' });
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });

  it('drops a completed old body when reader cleanup accepts another request', async () => {
    let newer: Promise<unknown> | undefined;
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode(JSON.stringify({ docs: [{ id: 'A' }] })),
      })
      .mockResolvedValueOnce({ done: true });
    const old = {
      ok: true,
      body: {
        getReader: () => ({
          read,
          releaseLock() {
            newer = merger.merge(request('B'));
          },
        }),
      },
    } as unknown as Response;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(old)
      .mockResolvedValueOnce(response());
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedB);
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });
});

describe('v2 refusal cancellation and diagnostic containment', () => {
  it.each(['http', 'exception'] as const)(
    'keeps a newer request accepted by the %s refusal abort listener',
    async (fault) => {
      let newer: Promise<unknown> | undefined;
      const secret = new Error('Authorization: Bearer secret-token');
      const oldJson = vi.fn();
      const old = { ok: false, status: 403, json: oldJson } as unknown as Response;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockImplementationOnce((_url, init) => {
          init?.signal?.addEventListener('abort', () => {
            newer = merger.merge(request('B'));
          });
          return fault === 'http' ? Promise.resolve(old) : Promise.reject(secret);
        })
        .mockResolvedValueOnce(response());
      const log = vi.fn();
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      try {
        await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
        await expect(newer).resolves.toEqual(mergedB);
        expect(fetchFn.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        expect(log).not.toHaveBeenCalled();
        expect(oldJson).not.toHaveBeenCalled();
      } finally {
        merger.destroy();
      }
    },
  );

  it.each(['http', 'exception'] as const)(
    'returns superseded when a current %s diagnostic accepts another request',
    async (fault) => {
      let newer: Promise<unknown> | undefined;
      const secret = new Error('Authorization: Bearer secret-token');
      const fetchFn = vi.fn<typeof fetch>();
      if (fault === 'http') {
        fetchFn.mockResolvedValueOnce(new Response('Access denied', { status: 403 }));
      } else {
        fetchFn.mockRejectedValueOnce(secret);
      }
      fetchFn.mockResolvedValueOnce(response());
      const log = vi.fn((..._args: unknown[]) => {
        newer = merger.merge(request('B'));
      });
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      try {
        await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
        await expect(newer).resolves.toEqual(mergedB);
        const diagnostic = log.mock.calls[0] ?? [];
        if (fault === 'http') expect(diagnostic).toEqual(['merge HTTP', 403]);
        else {
          expect(diagnostic[0]).toBe('merge exception');
          expect(diagnostic[1]).toBeInstanceOf(Error);
          expect(diagnostic[1]).not.toBe(secret);
          expect((diagnostic[1] as Error).message).toMatch(/legacy population/);
          expect(String(diagnostic[1])).not.toContain('secret-token');
        }
      } finally {
        merger.destroy();
      }
    },
  );

  it('drops a fetch rejection after the shim accepted a newer valid request', async () => {
    let newer: Promise<unknown> | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => {
        newer = merger.merge(request('B'));
        return Promise.reject(new Error('secret-token'));
      })
      .mockResolvedValueOnce(response());
    const log = vi.fn();
    const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
    try {
      await expect(merger.merge(request())).resolves.toEqual({ status: 'superseded' });
      await expect(newer).resolves.toEqual(mergedB);
      expect(log).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });
});
