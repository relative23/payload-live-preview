/**
 * Legacy schemas are instance-owned and old asynchronous work cannot publish
 * after detachment; explicit locale survives a schema-free legacy packet.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentSession } from '@adapters/shared/document-session';
import { populationURL } from '../../helpers/population';
const ADMIN = 'https://admin.example.com';
const schema = [{ name: 'author', type: 'relationship', relationTo: 'authors' }];
const stops: (() => void)[] = [];
const frames: HTMLIFrameElement[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const frame of frames.splice(0)) frame.remove();
});
const response = (id: string, name: string): Response =>
  new Response(JSON.stringify({ docs: [{ id, name }] }));
function send(
  target: Window,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): void {
  target.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      data: { type: 'payload-live-preview', data, ...extra },
    }),
  );
}
function session(
  fetchFn: typeof fetch,
  target: Window = window,
): DocumentSession<Record<string, unknown>> {
  return new DocumentSession(
    { author: { id: 'Initial', name: 'Last good' } },
    {
      serverURL: ADMIN,
      allowedOrigins: [ADMIN],
      enableLocalhostMatching: false,
      eventSourcePolicy: 'any',
      fetchFn,
      target,
    },
  );
}
describe('legacy document-session ownership', () => {
  it('preserves last-good data and revision when a needed relationship cannot be read', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('A', 'Ada'))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }));
    const held = session(fetchFn);
    stops.push(held.subscribe(() => {}));
    send(window, { author: 'A' }, { fieldSchemaJSON: schema });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('live'));
    const good = held.getSnapshot();
    send(window, { author: 'B' });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('unavailable'));
    expect(held.getSnapshot().data).toBe(good.data);
    expect(held.getSnapshot().revision).toBe(good.revision);
    expect(held.getSnapshot().error).toBeInstanceOf(Error);
  });
  it('does not begin a GET after the only listener detaches in loading publication', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const held = session(fetchFn);
    let warmed = false;
    const off = held.subscribe(() => {
      if (warmed && held.getSnapshot().isLoading) off();
    });
    send(window, { author: null }, { fieldSchemaJSON: schema });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('live'));
    const good = held.getSnapshot();
    warmed = true;
    send(window, { author: 'A' });
    await Promise.resolve();
    expect(held.getSnapshot().revision).toBe(good.revision);
    expect(held.getSnapshot().data).toBe(good.data);
    expect(fetchFn).not.toHaveBeenCalled();
  });
  it('drops a local result already resolved before the listener detaches', async () => {
    const held = session(vi.fn<typeof fetch>());
    const off = held.subscribe(() => {});
    send(window, { author: null }, { fieldSchemaJSON: schema });
    off();
    await Promise.resolve();
    expect(held.getSnapshot().revision).toBe(0);
    expect(held.getSnapshot().data['author']).toEqual({
      id: 'Initial',
      name: 'Last good',
    });
  });
  it('retains only its own schema across detach/reattach and drops the old ignored-abort response', async () => {
    let acceptOld: ((value: Response) => void) | undefined;
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            acceptOld = resolve;
          }),
      )
      .mockResolvedValue(response('B', 'Bea'));
    const held = session(fetchFn);
    const off = held.subscribe(() => {});
    send(window, { author: 'A' }, { fieldSchemaJSON: schema });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    off();
    stops.push(held.subscribe(() => {}));
    send(window, { author: 'B' });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('live'));
    acceptOld?.(response('A', 'Obsolete'));
    await Promise.resolve();
    expect(held.getSnapshot().data['author']).toEqual({ id: 'B', name: 'Bea' });
  });
  it('keeps two target windows schemas and snapshots independent', async () => {
    const a = document.createElement('iframe');
    const b = document.createElement('iframe');
    document.body.append(a, b);
    frames.push(a, b);
    const first = session(
      vi.fn<typeof fetch>().mockResolvedValue(response('A', 'Ada')),
      a.contentWindow ?? window,
    );
    const secondFetch = vi.fn<typeof fetch>();
    const second = session(secondFetch, b.contentWindow ?? window);
    stops.push(
      first.subscribe(() => {}),
      second.subscribe(() => {}),
    );
    send(a.contentWindow ?? window, { author: 'A' }, { fieldSchemaJSON: schema });
    send(
      b.contentWindow ?? window,
      { author: 'plain' },
      { fieldSchemaJSON: [{ name: 'author', type: 'text' }] },
    );
    await vi.waitFor(() => expect(first.getSnapshot().status).toBe('live'));
    await vi.waitFor(() => expect(second.getSnapshot().status).toBe('live'));
    expect(first.getSnapshot().data['author']).toEqual({
      id: 'A',
      name: 'Ada',
    });
    expect(second.getSnapshot().data['author']).toBe('plain');
    expect(secondFetch).not.toHaveBeenCalled();
  });
  it('keeps an explicitly sent locale in a later schema-free request', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response('A', 'Ada'));
    const held = session(fetchFn);
    stops.push(held.subscribe(() => {}));
    send(window, { author: null }, { fieldSchemaJSON: schema, locale: 'de' });
    await vi.waitFor(() => expect(held.getSnapshot().status).toBe('live'));
    send(window, { author: 'A' });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    expect(populationURL(fetchFn.mock.calls[0]?.[0]).searchParams.get('locale')).toBe('de');
  });
});
