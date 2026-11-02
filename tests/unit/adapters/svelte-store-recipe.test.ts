/**
 * The Svelte recipe in docs/sveltekit.md, on `svelte/store` itself: the session's
 * `subscribe` and `getSnapshot` have to fit a store, and the last subscriber
 * leaving has to end the session.
 */

import { readable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentSession,
  type DocumentSession,
  type DocumentSessionOptions,
} from '@/core-entry';

function livePreviewDocument<T>(
  initialData: T,
  options: DocumentSessionOptions,
): ReturnType<typeof readable<ReturnType<DocumentSession<T>['getSnapshot']>>> {
  const session = createDocumentSession(initialData, options);
  return readable(session.getSnapshot(), (set) =>
    session.subscribe(() => {
      set(session.getSnapshot());
    }),
  );
}

const ADMIN = 'https://admin.example.com';

/** A generated Payload document: an interface, which has no index signature. */
interface Page {
  id: string;
  title: string;
}

function post(title: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ADMIN,
      source: window.parent,
      data: { type: 'payload-live-preview', collectionSlug: 'pages', data: { id: '1', title } },
    }),
  );
}

describe('the Svelte store recipe', () => {
  it('takes a document typed by an interface', () => {
    const page: Page = { id: '1', title: 'Typed' };
    const session = createDocumentSession<Page>(page, { serverURL: 'https://cms.example.com' });
    expect(session.getSnapshot().data.title).toBe('Typed');
  });

  it('hands a subscriber the document, then each update, and stops with the last one', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(typeof init?.body === 'string' ? init.body : '{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const store = livePreviewDocument(
      { id: '1', title: 'Server' },
      {
        serverURL: 'https://cms.example.com',
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        fetchFn,
      },
    );
    const seen: unknown[] = [];
    const stop = store.subscribe((snapshot) => {
      seen.push(snapshot.status);
    });
    expect(seen).toEqual(['idle']);
    post('Typed');
    await vi.waitFor(() => {
      expect(seen.at(-1)).toBe('live');
    });
    stop();
    const calls = fetchFn.mock.calls.length;
    post('After the last subscriber left');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchFn.mock.calls.length).toBe(calls);
  });
});
