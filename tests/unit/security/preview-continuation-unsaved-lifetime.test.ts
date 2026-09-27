/**
 * The unsaved input, independent ACL read and population share one deadline.
 * Stalling each I/O boundary separately checks cancellation and cleanup without
 * treating a fetch implementation's cooperation as a security guarantee.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReferenceContinuation } from '../../fixtures/preview-continuation';
import { createReferenceUnsavedHandler } from '../../fixtures/preview-continuation-unsaved';
import {
  continuationHarness,
  CONTINUATION_SITE,
} from '../../fixtures/preview-continuation-harness';

const data = { title: 'Unsaved', related: [2], files: [1] };
const input = { version: 1, revision: 1, data };
const document = { id: 'post-a', ...data };
const phases = [
  'input',
  'saved-headers',
  'saved-body',
  'population-headers',
  'population-body',
] as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function scenario(phase: (typeof phases)[number]) {
  const h = continuationHarness();
  const reference = createReferenceContinuation({
    ...h.options,
    totalTimeoutMs: 100,
    binding: () => ({
      ...h.target,
      document: { kind: 'collection', slug: 'articles', id: 'post-a' },
    }),
  });
  const opened = await reference.exchange(
    h.request(`/page?locale=de&previewToken=${await h.token()}`),
  );
  expect(opened.status).toBe(303);
  const cookie = `${h.loginCookie}; ${opened.headers.get('set-cookie')!.split(';')[0]!}`;
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
        if (phase === 'input' || phase.endsWith('body')) {
          entered.resolve();
          await release.promise;
        }
        if (!cancelled) {
          c.enqueue(new TextEncoder().encode(JSON.stringify(phase === 'input' ? input : document)));
          c.close();
        }
        finished.resolve();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_url, init) => {
    const selected = (init?.method === 'POST') === phase.startsWith('population');
    if (!selected || phase === 'input') return Response.json(document);
    if (phase.endsWith('headers')) {
      entered.resolve();
      await release.promise;
      finished.resolve();
    }
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  });
  const controller = new AbortController();
  const request = new Request(h.request(undefined, cookie), {
    method: 'POST',
    headers: { cookie, origin: CONTINUATION_SITE, 'content-type': 'application/json' },
    body: phase === 'input' ? stream : JSON.stringify(input),
    signal: controller.signal,
    ...({ duplex: 'half' } as RequestInit),
  });
  const added = vi.spyOn(request.signal, 'addEventListener');
  const removed = vi.spyOn(request.signal, 'removeEventListener');
  return {
    h,
    entered,
    release,
    finished,
    stream,
    cancel,
    fetch,
    controller,
    request,
    added,
    removed,
    handle: createReferenceUnsavedHandler(reference, { fetch }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('unsaved continuation lifetime', () => {
  it.each(phases)(
    'bounds %s by the original deadline, including late completion',
    async (phase) => {
      const s = await scenario(phase);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const pending = s.handle(s.request);
      await s.entered.promise;
      try {
        await vi.advanceTimersByTimeAsync(100);
        const response = await pending;
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ version: 1, ok: false, error: 'forbidden' });
        s.release.resolve();
        if (!phase.endsWith('headers')) await s.finished.promise;
        await vi.advanceTimersByTimeAsync(0);
        expect(s.cancel).toHaveBeenCalledTimes(1);
        expect(s.stream.locked).toBe(false);
        expect(s.fetch).toHaveBeenCalledTimes(
          phase === 'input' ? 0 : phase.startsWith('saved') ? 1 : 2,
        );
        expect(s.removed).toHaveBeenCalledWith('abort', s.added.mock.calls[0]![1]);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        s.release.resolve();
        await pending;
      }
    },
  );

  it.each(phases)('cancels during %s without starting a later phase', async (phase) => {
    const s = await scenario(phase);
    const pending = s.handle(s.request);
    await s.entered.promise;
    s.controller.abort();
    expect((await pending).status).toBe(403);
    s.release.resolve();
    await vi.waitFor(() => expect(s.cancel).toHaveBeenCalledTimes(1));
    expect(s.stream.locked).toBe(false);
    expect(s.fetch).toHaveBeenCalledTimes(
      phase === 'input' ? 0 : phase.startsWith('saved') ? 1 : 2,
    );
  });

  it('does not restart the clock after the saved read', async () => {
    const s = await scenario('population-body');
    const savedEntered = deferred();
    const savedRelease = deferred();
    s.fetch.mockImplementationOnce(async () => {
      savedEntered.resolve();
      await savedRelease.promise;
      return Response.json(document);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    let done = false;
    const pending = s.handle(s.request).then((response) => {
      done = true;
      return response;
    });
    await savedEntered.promise;
    try {
      await vi.advanceTimersByTimeAsync(70);
      savedRelease.resolve();
      await s.entered.promise;
      await vi.advanceTimersByTimeAsync(29);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect((await pending).status).toBe(403);
    } finally {
      savedRelease.resolve();
      s.release.resolve();
      await pending;
    }
  });

  it.each(['saved-body', 'population-body'] as const)(
    'checks scope expiry after %s',
    async (phase) => {
      const s = await scenario(phase);
      const pending = s.handle(s.request);
      await s.entered.promise;
      s.h.advance(300_001);
      s.release.resolve();
      expect((await pending).status).toBe(403);
      expect(s.stream.locked).toBe(false);
      expect(s.fetch).toHaveBeenCalledTimes(phase === 'saved-body' ? 1 : 2);
    },
  );
});
