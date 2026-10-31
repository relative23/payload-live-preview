import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DocumentSession, type DocumentSessionOptions } from '@adapters/shared/document-session';

/**
 * The `document` option: a session that names the document it previews merges
 * only the messages for that document. Without it a session follows every
 * message the bus lets through (document-session.test.ts).
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
}

function post(message: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      source: window.parent,
      data: { type: 'payload-live-preview', ...message },
    }),
  );
}

function update(collectionSlug: string, id: string | number, title: string, extra = {}): void {
  post({ collectionSlug, data: { id, title }, ...extra });
}

/** A Payload REST stand-in: answers each merge with the document its URL names. */
function server(answer: (url: string) => Promise<void> = () => Promise.resolve()): {
  urls: string[];
  fetchFn: typeof fetch;
} {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    await answer(url);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      data: Record<string, unknown>;
    };
    return new Response(JSON.stringify({ ...body.data, merged: url }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { urls, fetchFn };
}

const stops: (() => void)[] = [];

function open(
  initial: Doc,
  fetchFn: typeof fetch,
  extra: Partial<DocumentSessionOptions> = {},
): DocumentSession<Doc> {
  const session = new DocumentSession<Doc>(initial, {
    serverURL: SERVER,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    fetchFn,
    ...extra,
  });
  stops.push(session.subscribe(() => {}));
  return session;
}

const settle = (ms = 30): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('DocumentSession with a document', () => {
  it('merges a message for its document and leaves one for another document alone', async () => {
    const one = server();
    const two = server();
    const first = open({ id: '1', title: 'One' }, one.fetchFn, {
      document: { collection: 'pages', id: '1' },
    });
    const second = open({ id: '2', title: 'Two' }, two.fetchFn, {
      document: { collection: 'pages', id: '2' },
    });
    update('pages', '1', 'Typed into one');
    await settle();
    expect(one.urls).toEqual([`${SERVER}/api/pages/1`]);
    expect(first.getSnapshot()).toMatchObject({ status: 'live', revision: 1 });
    expect(two.urls).toEqual([]);
    expect(second.getSnapshot()).toMatchObject({
      data: { id: '2', title: 'Two' },
      status: 'idle',
      isLoading: true,
      revision: 0,
    });
  });

  it('leaves the same id in another collection, or a global, alone, and matches a numeric id', async () => {
    const { urls, fetchFn } = server();
    const session = open({ id: '1', title: 'One' }, fetchFn, {
      document: { collection: 'pages', id: 1 },
    });
    update('posts', '1', 'A post');
    post({ globalSlug: 'header', data: { id: '1', title: 'A global' } });
    await settle();
    expect(urls).toEqual([]);
    // Each of them names its document; only a message that names none is worth a warning.
    expect(warn).not.toHaveBeenCalled();
    update('pages', 1, 'The page');
    await settle();
    expect(urls).toEqual([`${SERVER}/api/pages/1`]);
    expect(session.getSnapshot().status).toBe('live');
  });

  it('keeps its merge in flight when a message for another document arrives', async () => {
    let release: () => void = () => {};
    const { urls, fetchFn } = server(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const session = open({ id: '2', title: 'Two' }, fetchFn, {
      document: { collection: 'pages', id: '2' },
    });
    update('pages', '2', 'Typed into two');
    await settle(5);
    update('pages', '1', 'Typed into one');
    await settle(5);
    release();
    await settle();
    expect(urls).toEqual([`${SERVER}/api/pages/2`]);
    expect(session.getSnapshot()).toMatchObject({
      data: { title: 'Typed into two' },
      status: 'live',
      revision: 1,
    });
  });

  it('merges a global by its slug and nothing else', async () => {
    const { urls, fetchFn } = server();
    const session = open({ id: 'h', title: 'Header' }, fetchFn, {
      document: { global: 'header' },
    });
    post({ globalSlug: 'footer', data: { title: 'Footer' } });
    update('pages', '1', 'A page');
    await settle();
    expect(urls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    post({ globalSlug: 'header', data: { title: 'New header' } });
    await settle();
    expect(urls).toEqual([`${SERVER}/api/globals/header`]);
    expect(session.getSnapshot().status).toBe('live');
    post({ data: { title: 'Payload 2' } });
    await settle();
    expect(urls).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('previews global "header" and ignored');
  });

  it('with a locale, leaves a message in another locale alone and merges one without a locale', async () => {
    const { urls, fetchFn } = server();
    open({ id: '1', title: 'Eins' }, fetchFn, {
      document: { collection: 'pages', id: '1', locale: 'de' },
    });
    update('pages', '1', 'English', { locale: 'en' });
    await settle();
    expect(urls).toEqual([]);
    update('pages', '1', 'Deutsch', { locale: 'de' });
    await settle();
    update('pages', '1', 'Ohne Locale');
    await settle();
    expect(urls).toHaveLength(2);
    // Without a locale of its own, a session takes the update in whichever locale it comes.
    const any = server();
    open({ id: '1', title: 'One' }, any.fetchFn, { document: { collection: 'pages', id: '1' } });
    update('pages', '1', 'English', { locale: 'en' });
    await settle();
    expect(any.urls).toEqual([`${SERVER}/api/pages/1`]);
  });

  it('leaves a message that cannot prove its document alone, and warns once in development', async () => {
    // Payload 2 sends neither collectionSlug nor globalSlug; a create screen has no id yet.
    const { urls, fetchFn } = server();
    const session = open({ id: '1', title: 'One' }, fetchFn, {
      document: { collection: 'pages', id: '1' },
    });
    post({ data: { id: '1', title: 'Payload 2' } });
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[payload-live-preview] This hook previews collection "pages", id "1" and ignored an ' +
        'update that does not say which document it is for: Payload 2 sends no collection or ' +
        'global slug, and a create screen has no id yet.',
    );
    post({ data: { id: '1', title: 'Payload 2 again' } });
    await settle();
    expect(warn).toHaveBeenCalledTimes(1);
    // A second session has warned about nothing yet; a create screen's message has no id.
    open({ id: '1', title: 'One' }, fetchFn, { document: { collection: 'pages', id: '1' } });
    post({ collectionSlug: 'pages', data: { title: 'Create screen' } });
    await settle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(urls).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({ status: 'idle', revision: 0 });
  });

  it('stays silent about such a message in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { urls, fetchFn } = server();
    open({ id: 'h', title: 'Header' }, fetchFn, { document: { global: 'header' } });
    post({ data: { title: 'Payload 2' } });
    await settle();
    expect(urls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('without a document, still follows every message (the 2.x default)', async () => {
    const { urls, fetchFn } = server();
    const session = open({ id: '2', title: 'Two' }, fetchFn);
    update('pages', '1', 'Typed into one');
    await settle();
    expect(urls).toEqual([`${SERVER}/api/pages/1`]);
    expect(session.getSnapshot().status).toBe('live');
    expect(warn).not.toHaveBeenCalled();
  });
});
