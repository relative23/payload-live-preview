/**
 * Related authorization and body consumption share the original request clock.
 * Uncooperative late work may finish physically, but cannot fetch another target
 * or publish a partial revision after timeout, abort or grant expiry.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authorizePreviewRequest } from '@security/preview-authorization';
import { relatedHarness, relatedRefusal } from '../../fixtures/preview-related-harness';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const phases = ['authorization', 'headers', 'body'] as const;
async function scenario(phase: (typeof phases)[number]) {
  const s = await relatedHarness(2, 100);
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  let cancelled = false;
  const cancel = vi.fn(() => {
    cancelled = true;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(c) {
        if (phase === 'body') {
          entered.resolve();
          await release.promise;
        }
        if (!cancelled) {
          c.enqueue(new TextEncoder().encode(JSON.stringify(s.documents.get('records/2'))));
          c.close();
        }
        finished.resolve();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  if (phase === 'authorization') {
    s.authorize.mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      finished.resolve();
      return authorizePreviewRequest(...args);
    });
  } else {
    s.fetch.mockImplementation(async (url, init) => {
      if (!(url as string).includes('/records/2?')) return s.upstream(url, init);
      if (phase === 'headers') {
        entered.resolve();
        await release.promise;
        finished.resolve();
      }
      return new Response(stream, { headers: { 'content-type': 'application/json' } });
    });
  }
  const controller = new AbortController();
  const request = s.request(s.fields, 1, controller.signal);
  const added = vi.spyOn(request.signal, 'addEventListener');
  const removed = vi.spyOn(request.signal, 'removeEventListener');
  return { ...s, entered, release, finished, stream, cancel, controller, request, added, removed };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('related draft request lifetime', () => {
  it.each(phases)('bounds %s by the original deadline and disposes late bodies', async (phase) => {
    const s = await scenario(phase);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const pending = s.handle(s.request);
    await s.entered.promise;
    try {
      await vi.advanceTimersByTimeAsync(100);
      await relatedRefusal(await pending, 403);
      s.release.resolve();
      await s.finished.promise;
      await vi.advanceTimersByTimeAsync(0);
      if (phase !== 'authorization') expect(s.cancel).toHaveBeenCalledTimes(1);
      expect(s.stream.locked).toBe(false);
      expect(s.fetch).toHaveBeenCalledTimes(phase === 'authorization' ? 2 : 3);
      expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      s.release.resolve();
      await pending;
    }
  });

  it.each(phases)('refuses abort during %s before any subsequent read', async (phase) => {
    const s = await scenario(phase);
    const pending = s.handle(s.request);
    await s.entered.promise;
    s.controller.abort();
    await relatedRefusal(await pending, 403);
    s.release.resolve();
    await s.finished.promise;
    if (phase !== 'authorization') {
      await vi.waitFor(() => expect(s.cancel).toHaveBeenCalledTimes(1));
    }
    expect(s.fetch).toHaveBeenCalledTimes(phase === 'authorization' ? 2 : 3);
    expect(s.stream.locked).toBe(false);
  });

  it.each(phases)('refuses grant expiry while %s is pending', async (phase) => {
    const s = await scenario(phase);
    const pending = s.handle(s.request);
    await s.entered.promise;
    s.h.advance(300_001);
    s.release.resolve();
    await relatedRefusal(await pending, 403);
    expect(s.fetch).toHaveBeenCalledTimes(phase === 'authorization' ? 2 : 3);
  });

  it('does not restart the clock after root processing', async () => {
    const s = await scenario('body');
    const rootEntered = deferred();
    const rootRelease = deferred();
    s.fetch.mockImplementationOnce(async (url, init) => {
      rootEntered.resolve();
      await rootRelease.promise;
      return s.upstream(url, init);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let done = false;
    const pending = s.handle(s.request).then((value) => {
      done = true;
      return value;
    });
    await rootEntered.promise;
    try {
      await vi.advanceTimersByTimeAsync(70);
      rootRelease.resolve();
      await s.entered.promise;
      await vi.advanceTimersByTimeAsync(29);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      await relatedRefusal(await pending, 403);
    } finally {
      rootRelease.resolve();
      s.release.resolve();
      await pending;
    }
  });
});
