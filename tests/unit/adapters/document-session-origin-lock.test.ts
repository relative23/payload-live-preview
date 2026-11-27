import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentSession,
  type DocumentSession,
  type PreviewDocument,
} from '@adapters/shared/document-session';

/**
 * A hook session belongs to the admin whose update it accepted first, as the
 * DOM runtime's detector does (ADR 0007, row 39). Until 3.0 a session took an
 * update from every allowed origin for as long as it listened, so with two
 * admins on the list the second could write into a preview the first had
 * opened. The lock is taken by an update the session accepts for its document,
 * not by one it leaves alone, and it goes when the last subscriber leaves.
 */

const FIRST = 'https://admin.example.com';
const SECOND = 'https://staging-admin.example.com';
const SERVER = 'https://cms.example.com';

interface Doc extends Record<string, unknown> {
  id: string;
  title: string;
}

function post(origin: string, title: string, id = '1'): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin,
      source: window.parent,
      data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id, title } },
    }),
  );
}

/** A server that answers with the document it was sent, or with `status` when it is not 200. */
function server(status = 200): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>((_input, init) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      data?: unknown;
    };
    return Promise.resolve(
      new Response(JSON.stringify(body.data ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

let stop: (() => void) | undefined;

function open(
  fetchFn: typeof fetch,
  document: PreviewDocument | 'any' = 'any',
): DocumentSession<Doc> {
  const session = createDocumentSession<Doc>(
    { id: '1', title: 'From the server' },
    {
      document,
      serverURL: SERVER,
      allowedOrigins: [FIRST, SECOND],
      eventSourcePolicy: 'any',
      fetchFn,
    },
  );
  stop = session.subscribe(() => {});
  return session;
}

const shown = (session: DocumentSession<Doc>): { title: string; revision: number } => {
  const { data, revision } = session.getSnapshot();
  return { title: data.title, revision };
};

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('the origin a hook session listens to', () => {
  it('is the one whose update it accepted first: another allowed origin is refused after it', async () => {
    const fetchFn = server();
    const session = open(fetchFn);

    post(FIRST, 'From the first admin');
    await settle();
    expect(shown(session)).toEqual({ title: 'From the first admin', revision: 1 });

    post(SECOND, 'From the second admin');
    await settle();
    expect(shown(session)).toEqual({ title: 'From the first admin', revision: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);

    post(FIRST, 'From the first admin again');
    await settle();
    expect(shown(session)).toEqual({ title: 'From the first admin again', revision: 2 });
  });

  it('is either allowed origin, whichever speaks first', async () => {
    const session = open(server());

    post(SECOND, 'From the second admin');
    await settle();
    post(FIRST, 'From the first admin');
    await settle();

    expect(shown(session)).toEqual({ title: 'From the second admin', revision: 1 });
  });

  it('is not decided by an update for another document, which the session leaves alone', async () => {
    const session = open(server(), { collection: 'pages', id: '1' });

    post(SECOND, 'Another document', '2');
    await settle();
    post(FIRST, 'This document');
    await settle();
    expect(shown(session)).toEqual({ title: 'This document', revision: 1 });

    post(SECOND, 'This document, from the second admin');
    await settle();
    expect(shown(session)).toEqual({ title: 'This document', revision: 1 });
  });

  it('is decided when the update is accepted, whether or not the server then answers', async () => {
    const fetchFn = server(500);
    const session = open(fetchFn);

    post(FIRST, 'From the first admin');
    await settle();
    expect(session.getSnapshot().status).toBe('unavailable');

    post(SECOND, 'From the second admin');
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('is forgotten when the last subscriber leaves', async () => {
    const session = open(server());

    post(FIRST, 'From the first admin');
    await settle();
    stop?.();
    stop = session.subscribe(() => {});

    post(SECOND, 'From the second admin');
    await settle();
    expect(shown(session)).toEqual({ title: 'From the second admin', revision: 3 });
  });
});
