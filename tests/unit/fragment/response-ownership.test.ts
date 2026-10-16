/**
 * Each fragment attempt owns its response body until refusal or completion.
 * Native streams expose discarded producers and retained reader locks without
 * inspecting the handler's private cleanup functions. Successful EOF remains
 * distinct from cancellation, and an expired deadline starts no body read.
 */
import { setImmediate as nextImmediate } from 'node:timers';
import {
  ReadableStream as NativeReadableStream,
  type ReadableStreamDefaultController as NativeController,
} from 'node:stream/web';
import { describe, expect, it, vi } from 'vitest';
import {
  createFragmentHandler,
  type FragmentBoundary,
  type StrategyRequest,
} from '@fragment/index';

const ENDPOINT = '/payload/fragment';
const LOCATION = { pathname: '/page', search: '' };
const METADATA = { renderedAt: '2026-08-27T00:00:00Z', renderer: 'test' };
const BYTE_CAP = 512 * 1024;
type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('missing deferred resolver');
  };
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

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

const encoded = (text: string): Uint8Array => new TextEncoder().encode(text);
const nextTurn = (): Promise<void> => new Promise((resolve) => nextImmediate(resolve));

function observeUnhandled() {
  const reasons: unknown[] = [];
  const capture = (reason: unknown): void => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', capture);
  return {
    reasons,
    dispose: (): void => {
      process.off('unhandledRejection', capture);
    },
  };
}

function fragment(html = '<h1>Current ä😀</h1>', revision = 7): string {
  return JSON.stringify({ html, boundary: { id: 'hero' }, revision, metadata: METADATA });
}

function nativeBody(
  chunks: readonly Uint8Array[],
  closeAtEnd: boolean,
  init: ResponseInit = {},
  cancelEffect: () => void | Promise<void> = () => undefined,
) {
  let controller: NativeController<Uint8Array> | undefined;
  let pulls = 0;
  const firstPull = deferred<undefined>();
  const pendingRead = deferred<undefined>();
  const cancel = vi.fn(cancelEffect);
  const stream = new NativeReadableStream<Uint8Array>(
    {
      start(current) {
        controller = current;
      },
      pull(current) {
        const chunk = chunks[pulls];
        pulls += 1;
        firstPull.resolve(undefined);
        if (chunk !== undefined) {
          current.enqueue(chunk);
          if (closeAtEnd && pulls === chunks.length) current.close();
        } else if (closeAtEnd) current.close();
        else pendingRead.resolve(undefined);
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = new Response(stream as unknown as ReadableStream<Uint8Array>, {
    ...init,
    headers,
  });
  return {
    response,
    stream,
    cancel,
    firstPull: firstPull.promise,
    pendingRead: pendingRead.promise,
    pulls: () => pulls,
    fail: (error: Error): void => controller?.error(error),
    // The buggy handler may retain its reader. Producer-side error still ends
    // that pending read; calling stream.cancel() would instead reject on its lock.
    finish: (): void => controller?.error(new Error('response ownership test cleanup')),
  };
}

const refused = (code: 'LP0801' | 'LP0802' | 'LP0803', reason: string) => ({
  status: 'failed',
  code,
  reason,
});

describe('fragment response ownership — unread refusals', () => {
  it('discards a finite HTTP500 body without pulling it', async () => {
    const body = nativeBody([encoded('unread failure')], true, { status: 500 });
    const owner = new AbortController();
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    try {
      expect(await handler(request({ signal: owner.signal }), boundary())).toEqual(
        refused('LP0801', 'endpoint answered 500'),
      );
      expect(owner.signal.aborted).toBe(false);
      expect(body.pulls()).toBe(0);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.response.bodyUsed).toBe(true);
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
    }
  });
  it('settles HTTP500 before held producer cancellation completes', async () => {
    const cleanup = deferred<undefined>();
    const body = nativeBody([], false, { status: 500 }, () => cleanup.promise);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    const pending = handler(request(), boundary());
    try {
      // Any non-blocked promise continuation runs before this native event-loop
      // turn; the cleanup promise remains deliberately unresolved until finally.
      const observed = await Promise.race([
        pending.then((outcome) => ({ settled: true, outcome }) as const),
        nextTurn().then(() => ({ settled: false }) as const),
      ]);
      expect(observed).toEqual({
        settled: true,
        outcome: refused('LP0801', 'endpoint answered 500'),
      });
      expect(body.pulls()).toBe(0);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
    } finally {
      cleanup.resolve(undefined);
      body.finish();
      await pending.catch(() => undefined);
    }
  });
  it.each([
    { status: 401, code: 'LP0803', reason: 'endpoint refused the preview (401)', headers: {} },
    { status: 403, code: 'LP0803', reason: 'endpoint refused the preview (403)', headers: {} },
    {
      status: 200,
      code: 'LP0802',
      reason: 'unexpected content type "text/html"',
      headers: { 'content-type': 'text/html' },
    },
    {
      status: 200,
      code: 'LP0802',
      reason: 'response exceeds the size limit',
      headers: { 'content-length': String(BYTE_CAP + 1) },
    },
  ] as const)(
    'discards the unread body after $reason',
    async ({ status, code, reason, headers }) => {
      const body = nativeBody([], false, { status, headers });
      const current = nativeBody([encoded(fragment('<h1>Other current</h1>', 8))], true);
      const owner = new AbortController();
      const fetchFn = vi
        .fn<FetchLike>()
        .mockResolvedValueOnce(body.response)
        .mockResolvedValueOnce(current.response);
      const handler = createFragmentHandler({
        endpoint: ENDPOINT,
        location: LOCATION,
        fetch: fetchFn,
      });
      try {
        const [failure, success] = await Promise.all([
          handler(request({ signal: owner.signal }), boundary()),
          handler(request({ revision: 8 }), boundary()),
        ]);
        expect(failure).toEqual(refused(code, reason));
        expect(success).toEqual({
          status: 'rendered',
          html: '<h1>Other current</h1>',
          metadata: METADATA,
        });
        expect(current.cancel).not.toHaveBeenCalled();
        expect(current.pulls()).toBe(1);
        expect(owner.signal.aborted).toBe(false);
        expect(body.pulls()).toBe(0);
        expect(body.cancel).toHaveBeenCalledOnce();
        expect(body.response.bodyUsed).toBe(true);
        expect(body.stream.locked).toBe(false);
      } finally {
        body.finish();
        current.finish();
      }
    },
  );
  it('keeps HTTP500 authoritative when unread cancellation rejects', async () => {
    const body = nativeBody([], false, { status: 500 }, () =>
      Promise.reject(new Error('cleanup failed')),
    );
    const rejections = observeUnhandled();
    try {
      const handler = createFragmentHandler({
        endpoint: ENDPOINT,
        location: LOCATION,
        fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
      });
      expect(await handler(request(), boundary())).toEqual(
        refused('LP0801', 'endpoint answered 500'),
      );
      await nextTurn();
      expect(rejections.reasons).toEqual([]);
      expect(body.pulls()).toBe(0);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
      rejections.dispose();
    }
  });
});

describe('fragment response ownership — acquired readers', () => {
  it('releases natural UTF8 EOF without cancelling or aborting the completed request', async () => {
    vi.useFakeTimers();
    const bytes = encoded(fragment());
    const body = nativeBody(
      [...bytes].map((byte) => Uint8Array.of(byte)),
      true,
    );
    const owner = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<FetchLike>((_url, init) => {
      fetchSignal = init?.signal;
      return Promise.resolve(body.response);
    });
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
    });
    try {
      expect(await handler(request({ signal: owner.signal }), boundary())).toEqual({
        status: 'rendered',
        html: '<h1>Current ä😀</h1>',
        metadata: METADATA,
      });
      expect(body.pulls()).toBe(bytes.byteLength);
      owner.abort();
      vi.advanceTimersByTime(5_001);
      expect(fetchSignal?.aborted).toBe(false);
      expect(body.cancel).not.toHaveBeenCalled();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
      vi.useRealTimers();
    }
  });
  it('releases consumed invalid JSON without cancelling natural EOF', async () => {
    const body = nativeBody([encoded('{"html":')], true);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    try {
      expect(await handler(request(), boundary())).toEqual(
        refused('LP0802', 'response is not JSON'),
      );
      expect(body.cancel).not.toHaveBeenCalled();
      expect(body.response.bodyUsed).toBe(true);
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
    }
  });
  it('cancels and unlocks a pending read when its caller aborts, then returns the permit', async () => {
    const body = nativeBody([encoded('{"html":"')], false);
    const current = nativeBody([encoded(fragment('<h1>Next</h1>', 8))], true);
    const owner = new AbortController();
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(body.response)
      .mockResolvedValueOnce(current.response);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
      maxConcurrent: 1,
    });
    const rejections = observeUnhandled();
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      await body.pendingRead;
      const next = handler(request({ revision: 8 }), boundary());
      expect(fetchFn).toHaveBeenCalledOnce();
      owner.abort();
      expect(await pending).toEqual({ status: 'superseded' });
      expect(await next).toEqual({ status: 'rendered', html: '<h1>Next</h1>', metadata: METADATA });
      await nextTurn();
      expect(rejections.reasons).toEqual([]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(current.cancel).not.toHaveBeenCalled();
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
      current.finish();
      owner.abort();
      rejections.dispose();
      await pending.catch(() => undefined);
    }
  });
  it('cancels and unlocks a pending read on the unchanged 10ms deadline', async () => {
    vi.useFakeTimers();
    const body = nativeBody([encoded('{"html":"')], false);
    const current = nativeBody([encoded(fragment('<h1>Next</h1>', 8))], true);
    const owner = new AbortController();
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(body.response)
      .mockResolvedValueOnce(current.response);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
      timeoutMs: 10,
      maxConcurrent: 1,
    });
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      await body.pendingRead;
      const next = handler(request({ revision: 8 }), boundary());
      expect(fetchFn).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(10);
      expect(await pending).toEqual(refused('LP0801', 'timeout after 10 ms'));
      expect(await next).toEqual({ status: 'rendered', html: '<h1>Next</h1>', metadata: METADATA });
      expect(owner.signal.aborted).toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
      current.finish();
      vi.useRealTimers();
      await pending.catch(() => undefined);
    }
  });
  it('cuts a real UTF8 byte overrun off, cancels once and releases the reader', async () => {
    const bytes = encoded('ä'.repeat(32) + 'a');
    expect(bytes.byteLength).toBe(65);
    const body = nativeBody([bytes], false);
    const owner = new AbortController();
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      maxResponseBytes: 64,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    try {
      expect(await handler(request({ signal: owner.signal }), boundary())).toEqual(
        refused('LP0802', 'response exceeds the size limit'),
      );
      expect(owner.signal.aborted).toBe(false);
      expect(body.pulls()).toBe(1);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
    }
  });
  it('releases a naturally errored native read while retaining its original LP0801 reason', async () => {
    const body = nativeBody([], false);
    const owner = new AbortController();
    const rejections = observeUnhandled();
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      await body.pendingRead;
      body.fail(new Error('upstream read failed'));
      expect(await pending).toEqual(refused('LP0801', 'upstream read failed'));
      await nextTurn();
      expect(rejections.reasons).toEqual([]);
      expect(owner.signal.aborted).toBe(false);
      // A stream already in its errored state does not call its producer's cancel.
      expect(body.cancel).not.toHaveBeenCalled();
      expect(body.stream.locked).toBe(false);
    } finally {
      body.finish();
      rejections.dispose();
      await pending.catch(() => undefined);
    }
  });
});

describe('fragment response ownership — response delivered after cancellation', () => {
  it('settles an already expired deadline before the first pull of its late response', async () => {
    vi.useFakeTimers();
    const held = deferred<Response>();
    const body = nativeBody([], false);
    const owner = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const fetchFn = vi.fn<FetchLike>((_url, init) => {
      fetchSignal = init?.signal;
      return held.promise;
    });
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
      timeoutMs: 10,
    });
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      expect(fetchFn).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(10);
      expect(fetchSignal?.aborted).toBe(true);
      held.resolve(body.response);
      const first = await Promise.race([
        pending.then((outcome) => ({ kind: 'settled', outcome }) as const),
        body.firstPull.then(() => ({ kind: 'first-pull' }) as const),
      ]);
      // Original code deterministically wins with first-pull. The producer
      // controller in finally ends that read so this RED has no pending promise.
      expect(first).toEqual({ kind: 'settled', outcome: refused('LP0801', 'timeout after 10 ms') });
      expect(owner.signal.aborted).toBe(false);
      expect(body.pulls()).toBe(0);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.stream.locked).toBe(false);
      expect(fetchFn).toHaveBeenCalledOnce();
    } finally {
      held.resolve(body.response);
      body.finish();
      vi.useRealTimers();
      await pending.catch(() => undefined);
    }
  });
  it('discards a late unread response after caller abort without touching a new generation', async () => {
    const held = deferred<Response>();
    const body = nativeBody([], false);
    const current = nativeBody([encoded(fragment('<h1>New generation</h1>'))], true);
    const owner = new AbortController();
    const fetchFn = vi
      .fn<FetchLike>()
      .mockImplementationOnce(() => held.promise)
      .mockResolvedValueOnce(current.response);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
    });
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      owner.abort();
      expect(await handler(request(), boundary())).toEqual({
        status: 'rendered',
        html: '<h1>New generation</h1>',
        metadata: METADATA,
      });
      held.resolve(body.response);
      expect(await pending).toEqual({ status: 'superseded' });
      expect(current.cancel).not.toHaveBeenCalled();
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(body.pulls()).toBe(0);
      expect(body.cancel).toHaveBeenCalledOnce();
      expect(body.response.bodyUsed).toBe(true);
      expect(body.stream.locked).toBe(false);
    } finally {
      held.resolve(body.response);
      body.finish();
      current.finish();
      await pending.catch(() => undefined);
    }
  });
});

describe('fragment response ownership — positive outcome controls', () => {
  it('keeps a completed successful native fetch un-aborted after caller abort and deadline', async () => {
    vi.useFakeTimers();
    const body = nativeBody([encoded(fragment())], true);
    const owner = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      timeoutMs: 10,
      fetch: vi.fn<FetchLike>((_url, init) => {
        fetchSignal = init?.signal;
        return Promise.resolve(body.response);
      }),
    });
    try {
      expect(await handler(request({ signal: owner.signal }), boundary())).toEqual({
        status: 'rendered',
        html: '<h1>Current ä😀</h1>',
        metadata: METADATA,
      });
      owner.abort();
      vi.advanceTimersByTime(11);
      expect(fetchSignal?.aborted).toBe(false);
      expect(body.cancel).not.toHaveBeenCalled();
    } finally {
      body.finish();
      vi.useRealTimers();
    }
  });
  it('accepts the ASCII comparison body under the unchanged byte limit', async () => {
    const body = nativeBody([encoded(fragment('a'.repeat(250)))], true);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      maxResponseBytes: 400,
      fetch: vi.fn<FetchLike>().mockResolvedValue(body.response),
    });
    try {
      expect(await handler(request(), boundary())).toEqual({
        status: 'rendered',
        html: 'a'.repeat(250),
        metadata: METADATA,
      });
      expect(body.cancel).not.toHaveBeenCalled();
    } finally {
      body.finish();
    }
  });
  it('returns the current gate slot after a caller cancels a real pending body', async () => {
    const body = nativeBody([], false);
    const current = nativeBody([encoded(fragment('<h1>Next</h1>', 8))], true);
    const owner = new AbortController();
    const fetchFn = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(body.response)
      .mockResolvedValueOnce(current.response);
    const handler = createFragmentHandler({
      endpoint: ENDPOINT,
      location: LOCATION,
      fetch: fetchFn,
      maxConcurrent: 1,
    });
    const pending = handler(request({ signal: owner.signal }), boundary());
    try {
      await body.pendingRead;
      const next = handler(request({ revision: 8 }), boundary());
      expect(fetchFn).toHaveBeenCalledOnce();
      owner.abort();
      expect(await pending).toEqual({ status: 'superseded' });
      expect(await next).toEqual({ status: 'rendered', html: '<h1>Next</h1>', metadata: METADATA });
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(current.cancel).not.toHaveBeenCalled();
    } finally {
      body.finish();
      current.finish();
      owner.abort();
      await pending.catch(() => undefined);
    }
  });
});
