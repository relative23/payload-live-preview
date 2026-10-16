/**
 * The React and Vue session preserves its caller's REST options and listens on
 * the window that caller owns, including an injected window during SSR. Ready
 * and save messages do not replace the last good document or its server snapshot.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession, type DocumentSessionOptions } from '@adapters/shared/document-session';

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';
const INITIAL = { id: '1', title: 'Saved' };
const releases: (() => void)[] = [];

function open(options: Partial<DocumentSessionOptions> = {}) {
  const session = new DocumentSession(INITIAL, {
    serverURL: SERVER,
    allowedOrigins: [ADMIN],
    enableLocalhostMatching: false,
    eventSourcePolicy: 'any',
    ...options,
  });
  releases.push(session.subscribe(() => {}));
  return session;
}

function update(
  host: Window,
  options: { collectionSlug?: string } = { collectionSlug: 'pages' },
): void {
  host.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      source: host,
      data: {
        type: 'payload-live-preview',
        ...(options.collectionSlug === undefined ? {} : { collectionSlug: options.collectionSlug }),
        data: { id: '1', title: 'Unsaved' },
      },
    }),
  );
}

function response(): Response {
  return new Response(JSON.stringify({ id: '1', title: 'Populated' }), {
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DocumentSession caller boundaries', () => {
  it('forwards a custom REST prefix and population depth and keeps the server snapshot initial', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const session = open({ apiRoute: '/preview-rest', depth: 3, fetchFn });
    const serverSnapshot = session.getServerSnapshot();
    update(window);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('live'));
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${SERVER}/preview-rest/pages/1`);
    const body = init?.body;
    expect(typeof body).toBe('string');
    if (typeof body !== 'string') throw new Error('expected a JSON request body');
    expect(JSON.parse(body)).toMatchObject({ depth: 3 });
    expect(session.getSnapshot().data).toEqual({ id: '1', title: 'Populated' });
    expect(session.getSnapshot().revision).toBeGreaterThan(0);
    expect(session.getServerSnapshot()).toBe(serverSnapshot);
    expect(serverSnapshot).toMatchObject({ data: INITIAL, status: 'idle', revision: 0 });
  });

  it('listens on an injected window when the global window is absent', async () => {
    const host = window;
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    vi.stubGlobal('window', undefined);
    const session = open({ target: host, fetchFn });
    update(host);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('live'));
    expect(session.getSnapshot().data.title).toBe('Populated');
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(session.getServerSnapshot().data).toBe(INITIAL);
  });

  it('stays at its initial snapshot during SSR without an injected target', () => {
    vi.stubGlobal('window', undefined);
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const session = new DocumentSession(INITIAL, { serverURL: SERVER, fetchFn });
    const release = session.subscribe(() => {});
    releases.push(release);
    expect(session.getSnapshot()).toBe(session.getServerSnapshot());
    expect(fetchFn).not.toHaveBeenCalled();
    release();
    expect(session.getSnapshot()).toBe(session.getServerSnapshot());
  });

  it('shares one listener between subscribers and detaches only after the last one leaves', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const session = open({ fetchFn });
    const first = releases.at(-1)!;
    const second = session.subscribe(() => {});
    releases.push(second);
    expect(added.mock.calls.filter(([name]) => name === 'message')).toHaveLength(1);
    first();
    expect(removed.mock.calls.filter(([name]) => name === 'message')).toHaveLength(0);
    update(window);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('live'));
    second();
    expect(removed.mock.calls.filter(([name]) => name === 'message')).toHaveLength(1);
    const snapshot = session.getSnapshot();
    update(window);
    expect(session.getSnapshot()).toBe(snapshot);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('sends the ready handshake to a distinct opener on the accepted origin', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'opener');
    const postMessage = vi.fn();
    Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage } });
    try {
      open();
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payload-live-preview', ready: true }),
        ADMIN,
      );
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'opener');
      else Object.defineProperty(window, 'opener', descriptor);
    }
  });

  it('does not send a ready handshake to the listening window itself', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'opener');
    const postMessage = vi.spyOn(window, 'postMessage');
    Object.defineProperty(window, 'opener', { configurable: true, value: window });
    try {
      open();
      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      if (descriptor === undefined) Reflect.deleteProperty(window, 'opener');
      else Object.defineProperty(window, 'opener', descriptor);
    }
  });

  it('reports a non-Error fetch failure without replacing the last good document', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- injected fetch implementations may reject non-Error values
    const session = open({ fetchFn: () => Promise.reject('offline') });
    update(window);
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('unavailable'));
    expect(session.getSnapshot()).toMatchObject({ data: INITIAL, isLoading: false, revision: 0 });
    expect(session.getSnapshot().error?.message).toBe('live preview: the request failed');
  });

  it('explains a missing document endpoint without sending a request', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const session = open({ fetchFn });
    update(window, {});
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('unavailable'));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ data: INITIAL, isLoading: false, revision: 0 });
    expect(session.getSnapshot().error?.message).toBe(
      'live preview: the update could not be merged',
    );
  });

  it('accepts Payload ready and save notifications without starting a document merge', () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(response()));
    const listener = vi.fn();
    const session = open({ fetchFn });
    releases.push(session.subscribe(listener));
    const snapshot = session.getSnapshot();
    for (const data of [
      { type: 'payload-live-preview', ready: true },
      { type: 'payload-document-event', action: 'updated', slug: 'pages', id: '1' },
    ]) {
      window.dispatchEvent(new MessageEvent('message', { origin: ADMIN, source: window, data }));
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toBe(snapshot);
  });
});
