/**
 * Successful accessors may accept a newer request without throwing. Bind both
 * the dispatched work and cancellation ownership to the attempt that survives.
 */
import { describe, expect, it, vi } from 'vitest';
import { DataMerger, type MergeRequest } from '@core/data-merger';
import { deferred, jsonResponse } from './data-merger-harness';

const SERVER = 'https://cms.example.com';
const newest: MergeRequest = { collectionSlug: 'posts', data: { id: 'C', title: 'Newest' } };

describe('successful merge accessor reentry', () => {
  it.each(['globalSlug', 'id'] as const)(
    'dispatches only the newer request accepted by a successful %s getter',
    async (accessor) => {
      const responses: ReturnType<typeof deferred<Response>>[] = [];
      const fetchFn = vi.fn<typeof fetch>(() => {
        const response = deferred<Response>();
        responses.push(response);
        return response.promise;
      });
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      let replacement: Promise<unknown> | undefined;
      const accept = (): void => {
        if (replacement !== undefined) return;
        replacement = merger.merge(newest);
      };
      const older: MergeRequest =
        accessor === 'globalSlug'
          ? {
              get globalSlug() {
                accept();
                return 'homepage';
              },
              data: { title: 'Older' },
            }
          : {
              collectionSlug: 'posts',
              data: {
                get id() {
                  accept();
                  return 'A';
                },
              },
            };
      const outer = merger.merge(older);
      try {
        expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([`${SERVER}/api/posts/C`]);
        await expect(outer).resolves.toEqual({ status: 'superseded' });
        responses[0]?.resolve(jsonResponse({ id: 'C', title: 'Newest' }));
        await expect(replacement).resolves.toEqual({
          status: 'merged',
          doc: { id: 'C', title: 'Newest' },
        });
      } finally {
        merger.destroy();
        for (const response of responses) response.resolve(jsonResponse({ id: 'C' }));
        await Promise.all([outer, replacement]);
      }
    },
  );

  it('keeps the newer request cancellable after successful endpoint getter reentry', async () => {
    const response = deferred<Response>();
    const fetchFn = vi.fn<typeof fetch>(() => response.promise);
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    let replacement: Promise<unknown> | undefined;
    const outer = merger.merge({
      get globalSlug() {
        replacement = merger.merge(newest);
        return 'homepage';
      },
      data: {},
    });
    try {
      const newestSignal = fetchFn.mock.calls[0]?.[1]?.signal;
      merger.destroy();
      expect(newestSignal?.aborted).toBe(true);
      response.resolve(jsonResponse({ id: 'C' }));
      await expect(outer).resolves.toEqual({ status: 'superseded' });
      await expect(replacement).resolves.toEqual({ status: 'superseded' });
    } finally {
      merger.destroy();
      response.resolve(jsonResponse({ id: 'C' }));
      await Promise.all([outer, replacement]);
    }
  });
});

describe('serialized request ownership', () => {
  it.each(['toJSON', 'locale'] as const)(
    'does not dispatch the obsolete body after a successful %s accessor accepts another merge',
    async (accessor) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ id: 'C', title: 'Newest' }));
      const merger = new DataMerger({ serverURL: SERVER, fetchFn });
      let replacement: Promise<unknown> | undefined;
      const accept = (): void => {
        replacement = merger.merge(newest);
      };
      const older: MergeRequest =
        accessor === 'toJSON'
          ? {
              globalSlug: 'homepage',
              data: {
                toJSON() {
                  accept();
                  return { title: 'Older' };
                },
              },
            }
          : {
              globalSlug: 'homepage',
              data: {},
              get locale() {
                accept();
                return 'fr';
              },
            };
      try {
        const outer = merger.merge(older);
        await expect(outer).resolves.toEqual({ status: 'superseded' });
        await expect(replacement).resolves.toEqual({
          status: 'merged',
          doc: { id: 'C', title: 'Newest' },
        });
        expect(fetchFn.mock.calls.map(([url]) => url)).toEqual([`${SERVER}/api/posts/C`]);
      } finally {
        merger.destroy();
      }
    },
  );

  it('does not dispatch a valid endpoint after its getter destroys the merger', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ title: 'Older' }));
    const merger = new DataMerger({ serverURL: SERVER, fetchFn });
    try {
      await expect(
        merger.merge({
          get globalSlug() {
            merger.destroy();
            return 'homepage';
          },
          data: {},
        }),
      ).resolves.toEqual({ status: 'superseded' });
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      merger.destroy();
    }
  });
});

describe('response accessor ownership', () => {
  it.each(['ok-true', 'ok-false', 'status', 'json'] as const)(
    'does not read or diagnose the obsolete response after its %s getter accepts a newer merge',
    async (accessor) => {
      let replacement: Promise<unknown> | undefined;
      const oldJson = vi.fn(() => Promise.resolve({ title: 'Older' }));
      const log = vi.fn();
      const older = {
        get ok() {
          if (accessor === 'ok-true' || accessor === 'ok-false') replacement = merger.merge(newest);
          return accessor !== 'ok-false' && accessor !== 'status';
        },
        get status() {
          if (accessor === 'status') replacement = merger.merge(newest);
          return 503;
        },
        get json() {
          if (accessor === 'json') replacement = merger.merge(newest);
          return oldJson;
        },
      } as unknown as Response;
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(older)
        .mockResolvedValueOnce(jsonResponse({ id: 'C', title: 'Newest' }));
      const merger = new DataMerger({ serverURL: SERVER, fetchFn, log });
      try {
        await expect(merger.merge({ globalSlug: 'homepage', data: {} })).resolves.toEqual({
          status: 'superseded',
        });
        await expect(replacement).resolves.toEqual({
          status: 'merged',
          doc: { id: 'C', title: 'Newest' },
        });
        expect(oldJson).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
      } finally {
        merger.destroy();
      }
    },
  );
});

describe('legacy response accessor ownership', () => {
  it('does not abort the obsolete attempt again after its status getter accepts a newer merge', async () => {
    // Whatever supersedes an attempt has already aborted its controller; the obsolete
    // attempt returns without repeating that, so a late abort can never reach listeners.
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    let merger: DataMerger | undefined;
    try {
      const older = {
        ok: false,
        get status() {
          void merger?.merge({ schema: [], data: {} });
          return 503;
        },
      } as unknown as Response;
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(older);
      merger = new DataMerger({ serverURL: SERVER, fetchFn });
      await expect(
        merger.merge({
          schema: [{ name: 'author', type: 'relationship', relationTo: 'authors' }],
          data: { author: 'A' },
        }),
      ).resolves.toEqual({ status: 'superseded' });
      expect(abort).toHaveBeenCalledTimes(1);
    } finally {
      merger?.destroy();
      abort.mockRestore();
    }
  });
});
