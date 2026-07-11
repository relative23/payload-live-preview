import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { PluginManager } from '@plugins/manager';
import { documentSavePlugin } from '@plugins/built-in/document-save';

function setup() {
  const events = new EventEmitter();
  const logs: unknown[][] = [];
  const manager = new PluginManager({
    events,
    config: {},
    registerFieldRenderer: () => {},
    log: (...args) => {
      logs.push(args);
    },
  });
  return { events, logs, manager };
}

const ORIGINAL_FETCH = globalThis.fetch;
let reloadSpy: ReturnType<typeof vi.fn>;

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
    expect(logs.some((args) => args.map((a) => String(a)).join(' ').includes('revalidate failed'))).toBe(true);
  });
});

describe('documentSavePlugin — fetch (custom)', () => {
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
    expect(logs.some((args) => args.map((a) => String(a)).join(' ').includes('handler threw'))).toBe(true);
  });

  it('logs when strategy=fetch but no handler is supplied', async () => {
    const { manager, events, logs } = setup();
    await manager.register(documentSavePlugin({ strategy: 'fetch' }));
    await events.emit('documentSave', { timestamp: 1 });
    expect(logs.some((args) => args.map((a) => String(a)).join(' ').includes('no handler supplied'))).toBe(true);
  });
});
