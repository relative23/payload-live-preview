import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { documentSavePlugin } from '@plugins/built-in/document-save';
import type {
  DocumentSaveHandler,
  DocumentSavePluginOptions,
} from '@plugins/built-in/document-save';

function setup() {
  const events = new EventEmitter();
  const logs: unknown[][] = [];
  const manager = new PluginManager({
    events,
    config: {},
    registerFieldRenderer: () => () => {},
    log: (...args) => {
      logs.push(args);
    },
  });
  return { events, logs, manager };
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

async function drainMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
}

const ORIGINAL_FETCH = globalThis.fetch;
let reloadSpy: ReturnType<typeof vi.fn>;
let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Stub fetch + reload so we never actually navigate. jsdom's
  // `window.location.reload` is non-configurable in some versions,
  // so we redefine `window.location` as a whole.
  globalThis.fetch = vi.fn();
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: Object.assign(Object.create(null) as Record<string, unknown>, {
      href: 'http://localhost/',
      origin: 'http://localhost',
      reload: reloadSpy,
    }),
  });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('documentSavePlugin — silent (default)', () => {
  it('does not fetch or reload on documentSave', async () => {
    const { manager, events } = setup();
    await manager.register(documentSavePlugin());
    await events.emit('documentSave', { timestamp: 1 });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe('documentSavePlugin — reload', () => {
  it('triggers window.location.reload', async () => {
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'reload' }));
    await events.emit('documentSave', { timestamp: 1 });
    expect(reloadSpy).toHaveBeenCalledOnce();
  });
});

describe('documentSavePlugin — revalidate', () => {
  it('POSTs to the default endpoint with JSON body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'revalidate' }));
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/revalidate');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"source":"payload-live-preview"}');
  });

  it('honours a custom revalidateUrl + extra headers', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    const { manager, events } = setup();
    await manager.register(
      documentSavePlugin({
        strategy: 'revalidate',
        revalidateUrl: '/custom/api/revalidate',
        revalidateHeaders: { Authorization: 'Bearer x', 'X-Trace': '42' },
      }),
    );
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/custom/api/revalidate');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer x');
    expect(headers['X-Trace']).toBe('42');
  });

  it('reloads on revalidate failure when onRevalidateFailure=reload', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    const { manager, events } = setup();
    await manager.register(
      documentSavePlugin({ strategy: 'revalidate', onRevalidateFailure: 'reload' }),
    );
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(reloadSpy).toHaveBeenCalledOnce();
  });

  it('stays silent on revalidate failure by default', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('nope', { status: 500 }),
    );
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'revalidate' }));
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('handles network errors gracefully', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const { manager, events, logs } = setup();
    await manager.register(documentSavePlugin({ strategy: 'revalidate' }));
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(
      logs.some((args) =>
        args
          .map((a) => String(a))
          .join(' ')
          .includes('revalidate failed'),
      ),
    ).toBe(true);
  });

  it('aborts and suppresses pending revalidate effects after unregister', async () => {
    const response = deferred<Response>();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(response.promise);
    const { manager, events, logs } = setup();
    await manager.register(
      documentSavePlugin({ strategy: 'revalidate', onRevalidateFailure: 'reload' }),
    );
    logs.length = 0;
    await events.emit('documentSave', { timestamp: 1 });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const signal = init?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await manager.unregister('document-save');
    expect(signal?.aborted).toBe(true);
    response.resolve(new Response('nope', { status: 500 }));
    await Promise.resolve();
    await Promise.resolve();

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it('reports that revalidation is unavailable when the host has no fetch', async () => {
    Reflect.deleteProperty(globalThis, 'fetch');
    const { manager, events, logs } = setup();

    await manager.register(documentSavePlugin({ strategy: 'revalidate' }));
    await events.emit('documentSave', { timestamp: 1 });
    await drainMicrotasks();

    expect(logs.some((args) => args.join(' ').includes('needs fetch'))).toBe(true);
  });

  it('suppresses a rejected revalidate request after unregister', async () => {
    const request = deferred<Response>();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockReturnValue(request.promise);
    const { manager, events, logs } = setup();
    await manager.register(
      documentSavePlugin({ strategy: 'revalidate', onRevalidateFailure: 'reload' }),
    );
    logs.length = 0;
    await events.emit('documentSave', { timestamp: 1 });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const signal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;

    await manager.unregister('document-save');
    request.reject(new Error('aborted request'));
    await drainMicrotasks();

    expect(signal?.aborted).toBe(true);
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});

describe('documentSavePlugin — fetch (custom)', () => {
  it('keeps zero-argument option calls and signal-aware handlers type-compatible', () => {
    const legacy: DocumentSavePluginOptions = { handler: () => undefined };
    const signalAware: DocumentSaveHandler = (signal: AbortSignal) => {
      expect(signal).toBeInstanceOf(AbortSignal);
    };
    const controller = new AbortController();

    expect(legacy.handler?.()).toBeUndefined();
    void signalAware(controller.signal);
  });

  it('invokes the user-supplied handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'fetch', handler }));
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('logs but does not crash when handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const { manager, events, logs } = setup();
    await manager.register(documentSavePlugin({ strategy: 'fetch', handler }));
    await events.emit('documentSave', { timestamp: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(
      logs.some((args) =>
        args
          .map((a) => String(a))
          .join(' ')
          .includes('handler threw'),
      ),
    ).toBe(true);
  });

  it('logs when strategy=fetch but no handler is supplied', async () => {
    const { manager, events, logs } = setup();
    await manager.register(documentSavePlugin({ strategy: 'fetch' }));
    await events.emit('documentSave', { timestamp: 1 });
    expect(
      logs.some((args) =>
        args
          .map((a) => String(a))
          .join(' ')
          .includes('no handler supplied'),
      ),
    ).toBe(true);
  });

  it('aborts and suppresses a late handler rejection after unregister', async () => {
    const operation = deferred<undefined>();
    let receivedSignal: AbortSignal | undefined;
    const handler: DocumentSaveHandler = (signal) => {
      receivedSignal = signal;
      return operation.promise;
    };
    const { manager, events, logs } = setup();
    await manager.register(documentSavePlugin({ strategy: 'fetch', handler }));
    logs.length = 0;
    await events.emit('documentSave', { timestamp: 1 });

    await manager.unregister('document-save');
    operation.reject(new Error('late handler failure'));
    await drainMicrotasks();

    expect(receivedSignal?.aborted).toBe(true);
    expect(logs).toEqual([]);
  });
});
describe('documentSavePlugin — scroll preservation across reload', () => {
  beforeEach(() => {
    sessionStorage.clear();
    scrollToSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, value: scrollToSpy });
  });

  it('saves the scroll position before reloading', async () => {
    Object.defineProperty(window, 'scrollX', { configurable: true, value: 12 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 340 });
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'reload' }));
    await events.emit('documentSave', { timestamp: Date.now() });
    expect(reloadSpy).toHaveBeenCalledOnce();
    const saved = JSON.parse(
      sessionStorage.getItem('payload-live-preview:scroll') ?? '{}',
    ) as Record<string, unknown>;
    expect(saved['x']).toBe(12);
    expect(saved['y']).toBe(340);
    expect(saved['href']).toBe('http://localhost/');
  });

  it('restores the saved position on init when the URL matches', async () => {
    sessionStorage.setItem(
      'payload-live-preview:scroll',
      JSON.stringify({ href: 'http://localhost/', x: 5, y: 99 }),
    );
    const { manager } = setup();
    await manager.register(documentSavePlugin());
    expect(scrollToSpy).toHaveBeenCalledWith(5, 99);
    expect(sessionStorage.getItem('payload-live-preview:scroll')).toBeNull();
  });

  it('does not restore for a different URL', async () => {
    sessionStorage.setItem(
      'payload-live-preview:scroll',
      JSON.stringify({ href: 'http://elsewhere.example/', x: 5, y: 99 }),
    );
    const { manager } = setup();
    await manager.register(documentSavePlugin());
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('removes a corrupt saved position without attempting to restore it', async () => {
    sessionStorage.setItem('payload-live-preview:scroll', '{');
    const { manager } = setup();

    await manager.register(documentSavePlugin());

    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('payload-live-preview:scroll')).toBeNull();
  });

  it('defaults missing saved coordinates to the origin', async () => {
    sessionStorage.setItem(
      'payload-live-preview:scroll',
      JSON.stringify({ href: 'http://localhost/' }),
    );
    const { manager } = setup();

    await manager.register(documentSavePlugin());

    expect(scrollToSpy).toHaveBeenCalledWith(0, 0);
  });

  it('still reloads when scroll storage is unavailable', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    const { manager, events } = setup();
    await manager.register(documentSavePlugin({ strategy: 'reload' }));

    await events.emit('documentSave', { timestamp: 1 });

    expect(reloadSpy).toHaveBeenCalledOnce();
    setItem.mockRestore();
  });
});
