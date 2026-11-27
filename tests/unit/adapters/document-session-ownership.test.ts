/**
 * A session's asynchronous work belongs to its listeners: a read is not begun
 * for a session nobody listens to any more, an answer that arrives after the
 * last listener left publishes nothing, and the merge is asked in the locale
 * the update named.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDocumentSession, type DocumentSession } from '@adapters/shared/document-session';

const ADMIN = 'https://admin.example.com';
const INITIAL = { id: '1', author: { id: 'Initial', name: 'Last good' } };
const stops: (() => void)[] = [];

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const merged = (id: string, name: string): Response =>
  new Response(JSON.stringify({ id: '1', author: { id, name } }));

function send(data: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      data: { type: 'payload-live-preview', collectionSlug: 'posts', data, ...extra },
    }),
  );
}

function session(fetchFn: typeof fetch): DocumentSession<Record<string, unknown>> {
  return createDocumentSession<Record<string, unknown>>(INITIAL, {
    document: 'any',
    serverURL: ADMIN,
    allowedOrigins: [ADMIN],
    enableLocalhostMatching: false,
    eventSourcePolicy: 'any',
    fetchFn,
  });
}

describe('document-session ownership', () => {
  it('does not begin a read after the only listener detaches in the loading publication', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(merged('A', 'Ada'));
    const held = session(fetchFn);
    let warmed = false;
    const off = held.subscribe(() => {
      if (warmed && held.getSnapshot().isLoading) off();
    });
    send({ id: '1', author: 'A' });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('live'));
    const good = held.getSnapshot();
    warmed = true;
    send({ id: '1', author: 'B' });
    await Promise.resolve();
    expect(held.getSnapshot().revision).toBe(good.revision);
    expect(held.getSnapshot().data).toBe(good.data);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('drops an answer that arrives after the last listener left', async () => {
    let answer!: (response: Response) => void;
    const fetchFn = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const held = session(fetchFn);
    const off = held.subscribe(() => {});
    send({ id: '1', author: 'A' });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    off();
    answer(merged('A', 'Ada'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held.getSnapshot().revision).toBe(0);
    expect(held.getSnapshot().data['author']).toEqual({ id: 'Initial', name: 'Last good' });
  });

  it('asks for the merge in the locale the update names, and in none when it names none', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(merged('A', 'Ada fr'))
      .mockResolvedValueOnce(merged('B', 'Bob'));
    const held = session(fetchFn);
    stops.push(held.subscribe(() => {}));
    send({ id: '1', author: 'A' }, { locale: 'fr' });
    await vi.waitFor(() => expect(held.getSnapshot().revision).toBe(1));
    send({ id: '1', author: 'B' });
    await vi.waitFor(() => expect(held.getSnapshot().revision).toBe(2));
    const bodies = fetchFn.mock.calls.map(([, init]) => {
      const body = init?.body;
      if (typeof body !== 'string') throw new Error('the merge posts a JSON string');
      return JSON.parse(body) as Record<string, unknown>;
    });
    expect(bodies[0]).toMatchObject({ locale: 'fr', data: { id: '1', author: 'A' } });
    expect(bodies[1]).toMatchObject({ data: { id: '1', author: 'B' } });
    expect(Object.hasOwn(bodies[1] ?? {}, 'locale')).toBe(false);
  });
});
