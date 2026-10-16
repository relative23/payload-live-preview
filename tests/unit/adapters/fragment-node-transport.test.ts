/**
 * Native transport cancellation must reach the installed binding's Web request
 * without resetting its error response. These cases use real Web streams and
 * an observable socket; the production HTTP suite supplies the actual servers.
 */
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint as svelte } from '@adapters/sveltekit/fragments';
import { createFragmentEndpoint as nuxt } from '@adapters/nuxt/fragments';
import type { FragmentEndpointOptions } from '@adapters/shared/fragment-endpoint';
import { withNodeFragmentRequest } from '@adapters/shared/fragment-node-request';

const SITE = 'https://site.example';
const BODY = JSON.stringify({
  fragment: 'probe',
  route: '/page',
  search: '',
  revision: 1,
  fields: {},
});

describe('native request borrowing', () => {
  it.each([
    undefined,
    null,
    'wire value',
    {},
    { httpVersionMajor: 2 },
    { httpVersionMajor: 1, pause: null },
    { httpVersionMajor: 1, pause() {}, socket: null },
    { httpVersionMajor: 1, pause() {}, socket: { destroyed: false, on: null } },
    { httpVersionMajor: 1, pause() {}, socket: { destroyed: false, on() {} } },
    { ...nativeRequest(), httpVersionMajor: 2 },
    { ...nativeRequest(), pause: false },
    {
      ...nativeRequest(),
      socket: Object.assign(() => undefined, { destroyed: false, on() {}, removeListener() {} }),
    },
    { ...nativeRequest(), socket: { destroyed: 'false', on() {}, removeListener() {} } },
    { ...nativeRequest(), socket: { destroyed: false, on: false, removeListener() {} } },
    { ...nativeRequest(), socket: { destroyed: false, on() {}, removeListener: false } },
  ])('leaves non-HTTP/1 hosts with their own Web request (%j)', async (native) => {
    const incoming = request();
    const response = new Response('host');
    const handler = vi.fn(() => Promise.resolve(response));
    expect(await withNodeFragmentRequest(incoming, native, handler)).toBe(response);
    expect(handler).toHaveBeenCalledWith(incoming);
  });

  it.each(['locked', 'used'] as const)(
    'does not take ownership of an already %s body',
    async (mode) => {
      const incoming = request();
      const reader = mode === 'locked' ? incoming.body!.getReader() : undefined;
      if (mode === 'used') await incoming.text();
      const native = nativeRequest();
      const handler = vi.fn(() => Promise.resolve(new Response('host')));
      await withNodeFragmentRequest(incoming, native, handler);
      expect(handler).toHaveBeenCalledWith(incoming);
      expect(native.socket.listenerCount('close')).toBe(0);
      reader?.releaseLock();
    },
  );

  it.each(['socket', 'request'] as const)(
    'forwards an already closed %s before work begins',
    async (mode) => {
      const native = nativeRequest();
      const controller = new AbortController();
      if (mode === 'socket') native.socket.destroyed = true;
      else controller.abort();
      await withNodeFragmentRequest(request(BODY, controller.signal), native, (effective) => {
        expect(effective.signal.aborted).toBe(true);
        return Promise.resolve(new Response(null, { status: 400 }));
      });
      expect(native.socket.listenerCount('close')).toBe(0);
    },
  );

  it('retains Web-signal cancellation while a body read is pending', async () => {
    vi.useFakeTimers();
    const native = nativeRequest();
    const controller = new AbortController();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = adapters[0].endpoint(options())(request(stream, controller.signal), native);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(400);
    expect(cancel).not.toHaveBeenCalled();
    expect(stream.locked).toBe(false);
    expect(native.socket.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not prefetch a rejected body or drain its unread tail', async () => {
    const pull = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const native = nativeRequest();
    const incoming = request(stream);
    incoming.headers.set('origin', 'https://foreign.example');
    const response = await adapters[0].endpoint(options())(incoming, native);
    expect(response.status).toBe(403);
    expect(response.headers.get('connection')).toBe('close');
    expect(pull).not.toHaveBeenCalled();
    expect(native.pause).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('reports stream errors and releases the failed reader', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(target) {
        target.error(new Error('upload failed'));
      },
    });
    const native = nativeRequest();
    const response = await adapters[1].endpoint(options())(request(stream), native);
    expect(response.status).toBe(400);
    expect(response.headers.get('connection')).toBe('close');
    expect(stream.locked).toBe(false);
    expect(native.socket.listenerCount('close')).toBe(0);
  });

  it('does not close a bodyless request and preserves the original response', async () => {
    const native = nativeRequest();
    const response = new Response(null, { status: 405 });
    const result = await withNodeFragmentRequest(new Request(SITE), native, () =>
      Promise.resolve(response),
    );
    expect(result).toBe(response);
    expect(native.pause).not.toHaveBeenCalled();
    expect(native.socket.listenerCount('close')).toBe(0);
  });

  it('removes transport listeners even when a host pause throws during cleanup', async () => {
    const native = nativeRequest();
    native.pause.mockImplementation(() => {
      throw new Error('host cleanup failed');
    });
    const incoming = request();
    const remove = vi.spyOn(incoming.signal, 'removeEventListener');
    await expect(
      withNodeFragmentRequest(incoming, native, () => Promise.resolve(new Response('stop'))),
    ).rejects.toThrow('host cleanup failed');
    expect(native.socket.listenerCount('close')).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('releases a pending read on handler rejection without cancelling the host stream', async () => {
    const native = nativeRequest();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    let outcome: unknown;
    await expect(
      withNodeFragmentRequest(request(stream), native, async (effective) => {
        void effective
          .body!.getReader()
          .read()
          .then(
            (value) => {
              outcome = value;
            },
            (error: unknown) => {
              outcome = error;
            },
          );
        await Promise.resolve();
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    // There is no consumer after the rejected handler. The borrowed source is
    // released without forwarding cancel, even if the facade read stays pending.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(outcome).toBeUndefined();
    expect(stream.locked).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect(native.socket.listenerCount('close')).toBe(0);
  });
});
const adapters = [
  {
    name: 'sveltekit',
    endpoint: (options: FragmentEndpointOptions<object>) => {
      const handler = svelte(options);
      return (request: Request, req: unknown) => handler({ request, platform: { req } });
    },
  },
  {
    name: 'nuxt',
    endpoint: (options: FragmentEndpointOptions<object>) => {
      const handler = nuxt(options);
      return (request: Request, req: unknown) => handler(request, { node: { req } });
    },
  },
] as const;

function nativeRequest() {
  return {
    httpVersionMajor: 1,
    socket: Object.assign(new EventEmitter(), { destroyed: false }),
    pause: vi.fn(),
  };
}

function request(body: string | ReadableStream<Uint8Array> = BODY, signal?: AbortSignal) {
  return new Request(`${SITE}/fragment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body,
    ...(signal ? { signal } : {}),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

function options(
  overrides: Partial<FragmentEndpointOptions<object>> = {},
): FragmentEndpointOptions<object> {
  return {
    registry: { probe: { component: {}, props: () => ({}) } },
    authorize: { type: 'verifier', verify: () => ({ subject: 'editor' }) },
    render: () => Promise.resolve('<p>probe</p>'),
    limits: { totalTimeoutMs: 50, timeoutMs: 100 },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe.each(adapters)('$name native fragment transport', ({ endpoint }) => {
  it('links a post-upload socket close and removes the listener after refusal', async () => {
    vi.useFakeTimers();
    const native = nativeRequest();
    let effective: AbortSignal | undefined;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const render = vi.fn(() => Promise.resolve('<p>late</p>'));
    const handler = endpoint(
      options({
        registry: {
          probe: {
            component: {},
            props: ({ request: effectiveRequest }) => {
              effective = effectiveRequest.signal;
              started();
              return new Promise((resolve) =>
                effectiveRequest.signal.addEventListener('abort', () => resolve({}), {
                  once: true,
                }),
              );
            },
          },
        },
        render,
      }),
    );
    const pending = handler(request(), native);
    await entered;
    native.socket.emit('close');
    await vi.advanceTimersByTimeAsync(60);
    expect((await pending).status).toBe(400);
    expect(effective?.aborted).toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(native.socket.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a stalled-body deadline without cancelling the framework stream', async () => {
    vi.useFakeTimers();
    const native = nativeRequest();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const pending = endpoint(options())(request(stream), native);
    await vi.advanceTimersByTimeAsync(60);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: 'timeout' });
    expect(response.headers.get('connection')).toBe('close');
    expect(cancel).not.toHaveBeenCalled();
    expect(native.pause).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(native.socket.listenerCount('close')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a fully read success reusable and unhooks both cancellation sources', async () => {
    const native = nativeRequest();
    const controller = new AbortController();
    const incoming = request(BODY, controller.signal);
    const remove = vi.spyOn(incoming.signal, 'removeEventListener');
    let effective: AbortSignal | undefined;
    const response = await endpoint(
      options({
        render: (_component, _props, input) => {
          effective = input.request.signal;
          return Promise.resolve('<p>probe</p>');
        },
      }),
    )(incoming, native);
    expect(response.status).toBe(200);
    expect(response.headers.get('connection')).toBeNull();
    expect(native.socket.listenerCount('close')).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    native.socket.emit('close');
    controller.abort();
    expect(effective?.aborted).toBe(false);
  });
});
