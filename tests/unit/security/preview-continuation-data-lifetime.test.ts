/**
 * One clock must include authorization, headers and the complete data body.
 * Deliberately uncooperative I/O exposes late completion without allowing
 * another phase or a successful response after cancellation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReferenceContinuation } from '../../fixtures/preview-continuation';
import { createReferenceDataHandler } from '../../fixtures/preview-continuation-data';
import { continuationHarness } from '../../fixtures/preview-continuation-harness';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function scenario(phase: 'headers' | 'body', slowLogin = false) {
  const h = continuationHarness();
  const opened = await h.reference.exchange(
    h.request(`/page?locale=de&previewToken=${await h.token()}`),
  );
  const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
  const controller = new AbortController();
  const request = new Request(h.request(undefined, cookie), { signal: controller.signal });
  const added = vi.spyOn(request.signal, 'addEventListener');
  const removed = vi.spyOn(request.signal, 'removeEventListener');
  const loginEntered = deferred();
  const loginRelease = deferred();
  const entered = deferred();
  const release = deferred();
  const finished = deferred();
  let cancelled = false;
  const cancel = vi.fn(() => {
    cancelled = true;
  });
  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        async pull(stream) {
          if (phase === 'body') {
            entered.resolve();
            try {
              await release.promise;
            } finally {
              finished.resolve();
            }
          }
          if (!cancelled) {
            stream.enqueue(new TextEncoder().encode('{"id":"post-a","title":"Stored draft"}'));
            stream.close();
          }
        },
        cancel,
      },
      { highWaterMark: 0 },
    ),
    { headers: { 'content-type': 'application/json' } },
  );
  const json = vi.spyOn(response, 'json');
  const reference = createReferenceContinuation({
    ...h.options,
    totalTimeoutMs: 100,
    principal: async (req) => {
      if (slowLogin) {
        loginEntered.resolve();
        await loginRelease.promise;
      }
      return h.options.principal(req);
    },
  });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
    if (phase === 'headers') {
      entered.resolve();
      try {
        await release.promise;
      } finally {
        finished.resolve();
      }
    }
    return response;
  });
  const handle = createReferenceDataHandler(reference, { fetch });
  return {
    h,
    request,
    added,
    removed,
    controller,
    entered,
    release,
    finished,
    loginEntered,
    loginRelease,
    cancel,
    response,
    json,
    fetch,
    handle,
  };
}

function fakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('continuation data reference lifetime', () => {
  it.each(['headers', 'body'] as const)(
    'refuses stalled %s at the original deadline and discards a late success',
    async (phase) => {
      const s = await scenario(phase);
      fakeClock();
      let done = false;
      const pending = s.handle(s.request).then((result) => {
        done = true;
        return result;
      });
      await s.entered.promise;
      try {
        await vi.advanceTimersByTimeAsync(99);
        expect(done).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(done).toBe(true);
        const response = await pending;
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ version: 1, ok: false, error: 'forbidden' });
        expect(s.fetch.mock.calls[0]![1]?.signal?.aborted).toBe(true);
        s.release.resolve();
        await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(s.cancel).toHaveBeenCalledTimes(1);
        expect(s.response.body?.locked).toBe(false);
        expect(s.json).not.toHaveBeenCalled();
        expect(s.added).toHaveBeenCalledTimes(1);
        expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it.each(['headers', 'body'] as const)(
    'aborts while awaiting %s and observes late rejection',
    async (phase) => {
      const s = await scenario(phase);
      fakeClock();
      let done = false;
      const pending = s.handle(s.request).then((result) => {
        done = true;
        return result;
      });
      await s.entered.promise;
      try {
        s.controller.abort(new Error('private transport detail'));
        await vi.advanceTimersByTimeAsync(0);
        expect(done).toBe(true);
        expect((await pending).status).toBe(403);
        s.release.reject(new Error('private late backend detail'));
        await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(s.response.body?.locked).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it('does not give data I/O a fresh clock after slow login', async () => {
    const s = await scenario('body', true);
    fakeClock();
    let done = false;
    const pending = s.handle(s.request).then((result) => {
      done = true;
      return result;
    });
    await s.loginEntered.promise;
    try {
      await vi.advanceTimersByTimeAsync(70);
      s.loginRelease.resolve();
      await s.entered.promise;
      await vi.advanceTimersByTimeAsync(29);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect((await pending).status).toBe(403);
    } finally {
      s.loginRelease.resolve();
      s.release.resolve();
      await pending;
    }
  });

  it('refuses expiry during a body read and releases the reader', async () => {
    const s = await scenario('body');
    const pending = s.handle(s.request);
    await s.entered.promise;
    s.h.advance(300_001);
    s.release.resolve();
    expect((await pending).status).toBe(403);
    expect(s.response.body?.locked).toBe(false);
  });

  it('refuses an already-aborted request without login or fetch', async () => {
    const s = await scenario('headers');
    s.controller.abort();
    const result = await s.handle(s.request);
    expect(result.status).toBe(403);
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.h.store.read).not.toHaveBeenCalled();
  });

  it('cancels unread response bodies when synchronous fetch work crosses the deadline before its timer fires', async () => {
    const s = await scenario('headers');
    fakeClock();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    s.fetch.mockImplementationOnce(() => {
      clock.mockReturnValue(101);
      return Promise.resolve(s.response);
    });
    expect((await s.handle(s.request)).status).toBe(403);
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.json).not.toHaveBeenCalled();
    expect(s.response.body?.locked).toBe(false);
  });

  it('cancels unread response bodies when expiry is noticed before decoding', async () => {
    const s = await scenario('headers');
    s.fetch.mockImplementationOnce(() => {
      s.h.advance(300_001);
      return Promise.resolve(s.response);
    });
    expect((await s.handle(s.request)).status).toBe(403);
    expect(s.cancel).toHaveBeenCalledTimes(1);
    expect(s.json).not.toHaveBeenCalled();
    expect(s.response.body?.locked).toBe(false);
  });

  it('rejects synchronous JSON decoding that overruns the monotonic deadline', async () => {
    const s = await scenario('headers');
    fakeClock();
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const parse = JSON.parse;
    vi.spyOn(JSON, 'parse').mockImplementation((value: string) => {
      const result: unknown = parse(value);
      if (value.includes('Stored draft')) clock.mockReturnValue(101);
      return result;
    });
    s.release.resolve();
    expect((await s.handle(s.request)).status).toBe(403);
    expect(s.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps another data request independent while one body is stalled', async () => {
    const s = await scenario('body');
    fakeClock();
    let done = false;
    const pending = s.handle(s.request).then((result) => {
      done = true;
      return result;
    });
    await s.entered.promise;
    try {
      s.fetch.mockResolvedValueOnce(Response.json({ id: 'post-a', title: 'Independent read' }));
      const request = new Request(s.request.url, { headers: s.request.headers });
      const other = await s.handle(request);
      expect(other.status).toBe(200);
      expect(await other.json()).toMatchObject({ ok: true, data: { title: 'Independent read' } });
      s.controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(true);
      expect((await pending).status).toBe(403);
      expect(s.fetch).toHaveBeenCalledTimes(2);
      expect(s.fetch.mock.calls[0]![1]?.signal).not.toBe(s.fetch.mock.calls[1]![1]?.signal);
      expect(s.fetch.mock.calls[1]![1]?.signal?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      s.release.resolve();
      await pending;
    }
  });
});
