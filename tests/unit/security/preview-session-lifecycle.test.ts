/**
 * Session verification has both a local network timeout and the caller's
 * request lifetime. These tests distinguish cancellation from an ordinary
 * invalid session, including transports that settle after being aborted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authorizePreviewRequest,
  type FetchLike,
  type PreviewAuthorizationRequest,
} from '@security/preview-authorization';

const SITE = 'https://site.example.com';
const base = { type: 'payload-session', serverURL: 'https://cms.example.com' } as const;

function request(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): PreviewAuthorizationRequest {
  return { url, headers: new Headers(headers), ...(signal === undefined ? {} : { signal }) };
}

function fetchReturning(status: number, body: unknown): FetchLike {
  return () => Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body) });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Payload session request lifetime', () => {
  it('links the request abort signal into the Payload session fetch', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const fetch: FetchLike = (_input, init) => {
      fetchSignal = init.signal;
      return new Promise((resolve) => {
        init.signal.addEventListener(
          'abort',
          () => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
          { once: true },
        );
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ user: { id: 'late' } }),
            }),
          100,
        );
      });
    };
    const pending = authorizePreviewRequest(
      request(`${SITE}/`, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch },
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(100);

    expect((await pending).outcome).toBe('unavailable');
    expect(fetchSignal?.aborted).toBe(true);
  });

  it('keeps the local Payload session timeout when an upstream signal is present', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let fetchSignal: AbortSignal | undefined;
    const fetch: FetchLike = (_input, init) => {
      fetchSignal = init.signal;
      return new Promise((resolve) => {
        init.signal.addEventListener(
          'abort',
          () => resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }),
          { once: true },
        );
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ user: { id: 'late' } }),
            }),
          500,
        );
      });
    };
    const pending = authorizePreviewRequest(
      request(`${SITE}/`, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch, timeoutMs: 250 },
    );

    await vi.advanceTimersByTimeAsync(500);

    expect((await pending).outcome).toBe('unavailable');
    expect(fetchSignal?.aborted).toBe(true);
    expect(controller.signal.aborted).toBe(false);
  });

  it('removes the upstream abort listener after a successful session check', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    const result = await authorizePreviewRequest(
      request(`${SITE}/`, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch: fetchReturning(200, { user: { id: 'editor' } }) },
    );

    expect(result.authorized).toBe(true);
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a fetch for an already aborted request', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const fetch = vi.fn(fetchReturning(200, { user: { id: 'editor' } }));
    const result = await authorizePreviewRequest(
      request(SITE, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch },
    );
    expect(result.outcome).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refuses a late successful body after the caller has aborted', async () => {
    const controller = new AbortController();
    const json = vi.fn(() => {
      controller.abort();
      return Promise.resolve({ user: { id: 'late' } });
    });
    const fetch: FetchLike = () => Promise.resolve({ ok: true, status: 200, json });
    const result = await authorizePreviewRequest(
      request(SITE, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch },
    );
    expect(json).toHaveBeenCalledOnce();
    expect(result.outcome).toBe('unavailable');
  });

  it('does not begin reading a response that arrives after cancellation', async () => {
    const controller = new AbortController();
    const json = vi.fn(() => Promise.resolve({ user: { id: 'late' } }));
    const fetch: FetchLike = () => {
      controller.abort();
      return Promise.resolve({ ok: true, status: 200, json });
    };

    const result = await authorizePreviewRequest(
      request(SITE, { cookie: 'payload-token=x' }, controller.signal),
      { ...base, fetch },
    );
    expect(result.outcome).toBe('unavailable');
    expect(json).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, 250.5])('preserves refusal for invalid timeout %s', async (timeoutMs) => {
    const fetch = vi.fn(fetchReturning(200, { user: { id: 'editor' } }));
    const result = await authorizePreviewRequest(request(SITE, { cookie: 'payload-token=x' }), {
      ...base,
      fetch,
      timeoutMs,
    });
    expect(result.outcome).toBe('unavailable');
    expect(fetch).not.toHaveBeenCalled();
  });
});
