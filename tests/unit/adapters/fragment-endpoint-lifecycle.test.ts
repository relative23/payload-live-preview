/**
 * A fragment endpoint request may cross body reading, authorization, props and
 * rendering. These tests keep those phases observable so one configured total
 * deadline and its cooperative signal cannot silently become per-phase waits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFragmentEndpointHandler,
  type FragmentEndpointOptions,
  type FragmentRenderInput,
  type FragmentRenderer,
} from '@adapters/shared/fragment-endpoint';
import { authorizePreviewRequest } from '@security/preview-authorization';
import { PreviewConfigurationError } from '@security/preview-verdict';

const SITE = 'https://site.example.com';
const ENDPOINT = `${SITE}/payload/fragment`;

type Limits = NonNullable<FragmentEndpointOptions<string>['limits']>;
type AuthorizeHook = NonNullable<FragmentEndpointOptions<string>['authorizePreview']>;

interface HarnessOptions {
  readonly limits?: Limits;
  readonly authorizePreview?: AuthorizeHook;
  readonly props?: (input: FragmentRenderInput) => object | Promise<object>;
  readonly render?: FragmentRenderer<string>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

async function authorizedContext() {
  const authorization = await authorizePreviewRequest(new Request(`${SITE}/page`), {
    type: 'verifier',
    verify: () => ({ subject: 'editor' }),
  });
  if (!authorization.authorized) throw new Error('expected an authorized context');
  return authorization.context;
}

function endpoint(options: HarnessOptions = {}) {
  const render: FragmentRenderer<string> =
    options.render ??
    ((_component, props) => Promise.resolve(`<h1>${String(props['title'])}</h1>`));
  return createFragmentEndpointHandler(
    {
      registry: {
        hero: {
          component: 'Hero',
          props: options.props ?? (({ fields }) => ({ title: fields['title'] })),
        },
      },
      ...(options.authorizePreview === undefined
        ? { authorize: { type: 'verifier' as const, verify: () => ({ subject: 'editor' }) } }
        : { authorizePreview: options.authorizePreview }),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
      render,
    },
    { render, rendererName: 'test' },
  );
}

function fragmentRequest(signal?: AbortSignal, title = 'Hello'): Request {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body: JSON.stringify({
      fragment: 'hero',
      route: '/page',
      search: '',
      revision: 1,
      fields: { title },
    }),
    ...(signal === undefined ? {} : { signal }),
  });
}

function delayedBodyRequest(delayMs: number): Request {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      fragment: 'hero',
      route: '/page',
      search: '',
      revision: 1,
      fields: { title: 'Hello' },
    }),
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        controller.enqueue(bytes);
        controller.close();
      }, delayMs);
    },
  });
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

async function expectRefusal(
  pending: Promise<Response>,
  status: number,
  error: string,
): Promise<void> {
  const response = await pending;
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createFragmentEndpointHandler — request lifetime', () => {
  it('uses one configured deadline across authorization, props and rendering', async () => {
    vi.useFakeTimers();
    const context = await authorizedContext();
    const signals: AbortSignal[] = [];
    const render = vi.fn<FragmentRenderer<string>>(async (_component, _props, input) => {
      signals.push(input.signal);
      await delay(20);
      return '<h1>Hello</h1>';
    });
    const handler = endpoint({
      limits: { timeoutMs: 200, totalTimeoutMs: 50 },
      authorizePreview: async (request) => {
        signals.push(request.signal);
        await delay(20);
        return context;
      },
      props: async (input) => {
        signals.push(input.signal);
        await delay(20);
        return {};
      },
      render,
    });

    const pending = handler(fragmentRequest());
    await vi.advanceTimersByTimeAsync(100);

    await expectRefusal(pending, 504, 'timeout');
    expect(render).toHaveBeenCalledOnce();
    expect(signals).toHaveLength(3);
    // Request constructs a following signal, not the same signal object.
    expect(signals[2]).toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it('counts a delayed body read against the same total deadline', async () => {
    vi.useFakeTimers();
    const context = await authorizedContext();
    const render = vi.fn<FragmentRenderer<string>>(() => Promise.resolve('<h1>Hello</h1>'));
    const handler = endpoint({
      limits: { timeoutMs: 200, totalTimeoutMs: 50 },
      authorizePreview: async () => {
        await delay(20);
        return context;
      },
      props: async () => {
        await delay(20);
        return {};
      },
      render,
    });

    const pending = handler(delayedBodyRequest(20));
    await vi.advanceTimersByTimeAsync(100);

    await expectRefusal(pending, 504, 'timeout');
    expect(render).not.toHaveBeenCalled();
  });

  it.each(['returns', 'throws'])(
    'checks elapsed time when synchronous work %s before an overdue timer can run',
    async (settlement) => {
      vi.useFakeTimers();
      let elapsed = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
      const render = vi.fn<FragmentRenderer<string>>(() => Promise.resolve('<h1>late</h1>'));
      const handler = endpoint({
        limits: { totalTimeoutMs: 25 },
        props: () => {
          // Synchronous work can hold the event loop past the timer's deadline.
          // It cannot be interrupted, but its result must not start rendering.
          elapsed = 25;
          if (settlement === 'throws') throw new Error('late failure');
          return {};
        },
        render,
      });

      await expectRefusal(handler(fragmentRequest()), 504, 'timeout');
      expect(render).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('aborts authorization at the total deadline and never starts props', async () => {
    vi.useFakeTimers();
    const context = await authorizedContext();
    let authorizationSignal: AbortSignal | undefined;
    const props = vi.fn(() => ({}));
    const handler = endpoint({
      limits: { timeoutMs: 200, totalTimeoutMs: 25 },
      authorizePreview: (request) => {
        authorizationSignal = request.signal;
        return new Promise((resolve) => {
          request.signal.addEventListener('abort', () => resolve(context), { once: true });
          setTimeout(() => resolve(context), 100);
        });
      },
      props,
    });

    const pending = handler(fragmentRequest());
    await vi.advanceTimersByTimeAsync(100);

    await expectRefusal(pending, 504, 'timeout');
    expect(authorizationSignal?.aborted).toBe(true);
    expect(props).not.toHaveBeenCalled();
  });

  it('aborts cooperative props on its existing phase timeout', async () => {
    vi.useFakeTimers();
    let propsSignal: AbortSignal | undefined;
    const render = vi.fn<FragmentRenderer<string>>(() => Promise.resolve('<h1>late</h1>'));
    const handler = endpoint({
      limits: { timeoutMs: 25, totalTimeoutMs: 200 },
      props: (input) => {
        propsSignal = input.signal;
        return new Promise((resolve) => {
          input.signal.addEventListener('abort', () => resolve({}), { once: true });
          setTimeout(() => resolve({}), 100);
        });
      },
      render,
    });

    const pending = handler(fragmentRequest());
    await vi.advanceTimersByTimeAsync(100);

    await expectRefusal(pending, 500, 'render');
    expect(propsSignal?.aborted).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  it('aborts cooperative rendering on its existing phase timeout', async () => {
    vi.useFakeTimers();
    let renderSignal: AbortSignal | undefined;
    const render = vi.fn<FragmentRenderer<string>>((_component, _props, input) => {
      renderSignal = input.signal;
      return new Promise((resolve) => {
        input.signal.addEventListener('abort', () => resolve('<h1>late</h1>'), { once: true });
        setTimeout(() => resolve('<h1>late</h1>'), 100);
      });
    });
    const handler = endpoint({
      limits: { timeoutMs: 25, totalTimeoutMs: 200 },
      render,
    });

    const pending = handler(fragmentRequest());
    await vi.advanceTimersByTimeAsync(100);

    await expectRefusal(pending, 500, 'render');
    expect(renderSignal?.aborted).toBe(true);
  });

  it('links a client abort after body read and does not start rendering', async () => {
    const controller = new AbortController();
    const propsStarted = deferred();
    let propsSignal: AbortSignal | undefined;
    const render = vi.fn<FragmentRenderer<string>>(() => Promise.resolve('<h1>late</h1>'));
    const handler = endpoint({
      limits: { timeoutMs: 200, totalTimeoutMs: 500 },
      props: (input) => {
        propsSignal = input.signal;
        propsStarted.resolve();
        return new Promise((resolve) => {
          input.signal.addEventListener('abort', () => resolve({}), { once: true });
          controller.signal.addEventListener('abort', () => resolve({}), { once: true });
        });
      },
      render,
    });

    const pending = handler(fragmentRequest(controller.signal));
    await propsStarted.promise;
    controller.abort();

    await expectRefusal(pending, 400, 'request');
    expect(propsSignal?.aborted).toBe(true);
    expect(render).not.toHaveBeenCalled();
  });

  it('keeps parallel request abort scopes isolated', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstStarted = deferred();
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;
    const render = vi.fn<FragmentRenderer<string>>((_component, props) =>
      Promise.resolve(`<h1>${String(props['title'])}</h1>`),
    );
    const handler = endpoint({
      limits: { timeoutMs: 200, totalTimeoutMs: 500 },
      props: (input) => {
        if (input.fields['title'] === 'First') {
          firstSignal = input.signal;
          firstStarted.resolve();
          return new Promise((resolve) => {
            input.signal.addEventListener('abort', () => resolve({ title: 'First' }), {
              once: true,
            });
            firstController.signal.addEventListener('abort', () => resolve({ title: 'First' }), {
              once: true,
            });
          });
        }
        secondSignal = input.signal;
        return { title: 'Second' };
      },
      render,
    });

    const first = handler(fragmentRequest(firstController.signal, 'First'));
    await firstStarted.promise;
    const second = handler(fragmentRequest(secondController.signal, 'Second'));
    expect((await second).status).toBe(200);
    firstController.abort();

    await expectRefusal(first, 400, 'request');
    expect(firstSignal).not.toBe(secondSignal);
    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);
    expect(render).toHaveBeenCalledOnce();
  });

  it.each(['authorization', 'props', 'render'])(
    'consumes a late %s rejection after the total deadline response',
    async (phase) => {
      vi.useFakeTimers();
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const rejectLater = () =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('late failure')), 100);
          });
        const handler = endpoint({
          limits: { timeoutMs: 200, totalTimeoutMs: 25 },
          ...(phase === 'authorization' ? { authorizePreview: rejectLater } : {}),
          ...(phase === 'props' ? { props: rejectLater } : {}),
          ...(phase === 'render' ? { render: rejectLater } : {}),
        });

        const pending = handler(fragmentRequest());
        await vi.advanceTimersByTimeAsync(125);

        await expectRefusal(pending, 504, 'timeout');
        await Promise.resolve();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    },
  );

  it('cancels a pending body at the total deadline and releases its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => Promise.reject(new Error('broken transport')));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const authorizePreview = vi.fn<AuthorizeHook>(() => Promise.resolve(null));
    const request = new Request(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const handler = endpoint({ limits: { totalTimeoutMs: 25 }, authorizePreview });

    const pending = handler(request);
    await vi.advanceTimersByTimeAsync(25);
    await expectRefusal(pending, 504, 'timeout');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(authorizePreview).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases its scope but preserves a loud authorization configuration failure', async () => {
    vi.useFakeTimers();
    const request = fragmentRequest();
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    const failure = new PreviewConfigurationError('invalid configuration');
    const handler = endpoint({
      limits: { totalTimeoutMs: 25 },
      authorizePreview: () => {
        throw failure;
      },
    });

    await expect(handler(request)).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its upstream listener and timer after a successful request', async () => {
    vi.useFakeTimers();
    const upstream = new AbortController();
    const request = fragmentRequest(upstream.signal);
    const add = vi.spyOn(request.signal, 'addEventListener');
    const remove = vi.spyOn(request.signal, 'removeEventListener');
    let inputSignal: AbortSignal | undefined;
    const handler = endpoint({
      limits: { totalTimeoutMs: 100 },
      props: (input) => {
        inputSignal = input.signal;
        return {};
      },
    });

    const response = await handler(request);

    expect(response.status).toBe(200);
    expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    upstream.abort();
    expect(inputSignal?.aborted).toBe(false);
  });

  it('keeps the existing phase windows when no total deadline is configured', async () => {
    vi.useFakeTimers();
    const context = await authorizedContext();
    const handler = endpoint({
      limits: { timeoutMs: 25 },
      authorizePreview: async () => {
        await delay(20);
        return context;
      },
      props: async () => {
        await delay(20);
        return {};
      },
      render: async () => {
        await delay(20);
        return '<h1>Hello</h1>';
      },
    });

    const pending = handler(fragmentRequest());
    await vi.advanceTimersByTimeAsync(100);

    expect((await pending).status).toBe(200);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['zero', 0],
    ['fractional', 1.5],
    ['timer overflow', 2_147_483_648],
  ] as const)('rejects a %s totalTimeoutMs configuration synchronously', (_label, value) => {
    expect(() => endpoint({ limits: { totalTimeoutMs: value } })).toThrow(/totalTimeoutMs/u);
  });
});
