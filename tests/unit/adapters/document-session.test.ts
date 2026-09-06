import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';

/**
 * The five failure cases measured against `@payloadcms/live-preview` in the
 * 3.88 comparison. Each one is a way a preview can show something that is not
 * the document — a stale value, an error body, a half-merged mix — and each is
 * asserted here on the session the React and Vue hooks are built from.
 *
 * The companion file `payload-hook-comparison.test.ts` runs the same shapes
 * against the official package, so the difference is recorded rather than
 * claimed.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
  author?: { name: string };
}

const INITIAL: Doc = { id: '1', title: 'From the server', author: { name: 'Ada' } };

/** The admin's message, as Payload 3.x posts it: raw form values, no schema. */
function update(fields: Record<string, unknown>): MessageEvent {
  return new MessageEvent('message', {
    origin: ADMIN,
    source: window.parent,
    data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id: '1', ...fields } },
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

/** Waits for the session to publish a snapshot the predicate accepts. */
async function until<T>(
  session: DocumentSession<T>,
  accept: (snapshot: ReturnType<DocumentSession<T>['getSnapshot']>) => boolean,
): Promise<ReturnType<DocumentSession<T>['getSnapshot']>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = session.getSnapshot();
    if (accept(snapshot)) return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`no snapshot matched; last was ${JSON.stringify(session.getSnapshot())}`);
}

let sessions: DocumentSession<Doc>[] = [];
let release: (() => void)[] = [];

function open(options: Partial<Parameters<typeof createSession>[0]> = {}): DocumentSession<Doc> {
  const session = createSession(options);
  sessions.push(session);
  release.push(session.subscribe(() => {}));
  return session;
}

function createSession(
  options: Partial<{ serverURL: string; fetchFn: typeof fetch; depth: number }> = {},
): DocumentSession<Doc> {
  return new DocumentSession<Doc>(INITIAL, {
    serverURL: options.serverURL ?? SERVER,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    ...(options.fetchFn !== undefined ? { fetchFn: options.fetchFn } : {}),
    ...(options.depth !== undefined ? { depth: options.depth } : {}),
  });
}

beforeEach(() => {
  sessions = [];
  release = [];
});

afterEach(() => {
  for (const stop of release) stop();
});

describe('DocumentSession', () => {
  it('merges an update through the REST API and reports it live', async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse({ id: '1', title: 'Merged', author: { name: 'Ada' } })),
    );
    const session = open({ fetchFn: fetchFn as unknown as typeof fetch });

    window.dispatchEvent(update({ title: 'Typed in the admin' }));

    const snapshot = await until(session, (s) => s.status === 'live');
    expect(snapshot.data.title).toBe('Merged');
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.error).toBeUndefined();
    const call = fetchFn.mock.calls[0];
    expect(call?.[0]).toBe(`${SERVER}/api/pages/1`);
    const headers = call?.[1]?.headers as Record<string, string> | undefined;
    expect(headers?.['X-Payload-HTTP-Method-Override']).toBe('GET');
  });

  it('1. merges even when serverURL carries a trailing slash', async () => {
    const fetchFn = vi.fn((_url: string) =>
      Promise.resolve(jsonResponse({ id: '1', title: 'Merged' })),
    );
    const session = open({
      serverURL: `${SERVER}/`,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    window.dispatchEvent(update({ title: 'Typed' }));

    await until(session, (s) => s.status === 'live');
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`${SERVER}/api/pages/1`);
  });

  it('2. lets the newer response win when an older one overtakes it', async () => {
    const bodies = [
      { id: '1', title: 'First (slow)' },
      { id: '1', title: 'Second (fast)' },
    ];
    let call = 0;
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      const index = call++;
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
        setTimeout(
          () => {
            resolve(jsonResponse(bodies[index]));
          },
          index === 0 ? 40 : 5,
        );
      });
    });
    const session = open({ fetchFn: fetchFn as unknown as typeof fetch });

    window.dispatchEvent(update({ title: 'first' }));
    window.dispatchEvent(update({ title: 'second' }));

    const snapshot = await until(session, (s) => s.status === 'live');
    expect(snapshot.data.title).toBe('Second (fast)');
    // And it stays that way: the slow one resolves later and is discarded.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(session.getSnapshot().data.title).toBe('Second (fast)');
  });

  it('3. keeps the last good document and says so when the request fails', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const session = open({ fetchFn: fetchFn as unknown as typeof fetch });

    window.dispatchEvent(update({ title: 'Typed' }));

    const snapshot = await until(session, (s) => s.status === 'unavailable');
    expect(snapshot.data).toEqual(INITIAL);
    expect(snapshot.isLoading).toBe(false);
    expect(snapshot.error?.message).toContain('Failed to fetch');
  });

  it('4. never turns an error body into the document', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { errors: [{ message: 'You are not allowed to perform this action' }] },
          {
            status: 403,
          },
        ),
      ),
    );
    const session = open({ fetchFn: fetchFn as unknown as typeof fetch });

    window.dispatchEvent(update({ title: 'Typed' }));

    const snapshot = await until(session, (s) => s.status === 'unavailable');
    expect(snapshot.data).toEqual(INITIAL);
    expect(snapshot.data).not.toHaveProperty('errors');
    expect(snapshot.error?.message).toContain('403');
  });

  it('5. gives two sessions on one page two documents', async () => {
    const first = open({
      fetchFn: (() =>
        Promise.resolve(jsonResponse({ id: '1', title: 'First hook' }))) as unknown as typeof fetch,
    });
    const second = open({
      fetchFn: (() =>
        Promise.resolve(
          jsonResponse({ id: '1', title: 'Second hook' }),
        )) as unknown as typeof fetch,
    });

    window.dispatchEvent(update({ title: 'Typed' }));

    await until(first, (s) => s.status === 'live');
    await until(second, (s) => s.status === 'live');
    expect(first.getSnapshot().data.title).toBe('First hook');
    expect(second.getSnapshot().data.title).toBe('Second hook');
  });

  it('refuses an update from an origin that is not allowed', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ id: '1', title: 'Merged' })));
    const session = open({ fetchFn: fetchFn as unknown as typeof fetch });

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://evil.example.com',
        source: window.parent,
        data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id: '1' } },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe('idle');
  });

  it('stops listening when the last subscriber leaves', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse({ id: '1', title: 'Merged' })));
    const session = createSession({ fetchFn: fetchFn as unknown as typeof fetch });
    const stop = session.subscribe(() => {});
    stop();

    window.dispatchEvent(update({ title: 'Typed' }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('renders on the server as the document it was given', () => {
    const session = createSession();

    expect(session.getServerSnapshot()).toEqual({
      data: INITIAL,
      isLoading: true,
      status: 'idle',
      error: undefined,
    });
  });
});
