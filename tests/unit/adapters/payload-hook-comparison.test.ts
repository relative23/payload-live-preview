import { describe, expect, it, vi } from 'vitest';
import { handleMessage, subscribe } from '@payloadcms/live-preview';

/**
 * The same five shapes as `document-session.test.ts`, run against
 * `@payloadcms/live-preview` 3.88 — the package `@payloadcms/live-preview-react`
 * is a thin wrapper around.
 *
 * This is not a criticism test and it does not gate the official package: it
 * records what the comparison in the 3.88 report measured, so a claim in
 * docs/react.md is a fact with a file behind it rather than marketing. If a
 * later release changes any of this, this file fails and the claim goes.
 *
 * It is a devDependency, so the suite always runs it; nothing here is skipped.
 */

const SERVER = 'https://cms.example.com';

/** The message shape their `LivePreviewMessageEvent<T>` describes. */
interface PreviewMessage {
  readonly type: 'payload-live-preview';
  readonly collectionSlug: string;
  readonly data: { id: string; title: string };
}

function event(
  data: { data: { id: string; title: string } },
  origin = SERVER,
): MessageEvent<PreviewMessage> {
  return new MessageEvent<PreviewMessage>('message', {
    origin,
    data: { type: 'payload-live-preview', collectionSlug: 'pages', ...data },
  });
}

/** Their request handler contract: it returns the `Response` `mergeData` reads. */
function handlerReturning(body: unknown, status = 200) {
  return vi.fn((_args: { endpoint: string; serverURL: string }) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('@payloadcms/live-preview, for comparison', () => {
  it('1. ignores every message when serverURL carries a trailing slash', async () => {
    const requestHandler = handlerReturning({ id: '1', title: 'Merged' });

    const result = await handleMessage({
      apiRoute: '/api',
      depth: 1,
      event: event({ data: { id: '1', title: 'Typed' } }),
      initialData: { id: '1', title: 'From the server' },
      requestHandler,
      serverURL: `${SERVER}/`,
    });

    // `isLivePreviewEvent` compares `event.origin === serverURL` verbatim.
    expect(requestHandler).not.toHaveBeenCalled();
    expect(result).toEqual({ id: '1', title: 'From the server' });
  });

  it('2. lets a slow response overwrite a newer one', async () => {
    const bodies = ['First (slow)', 'Second (fast)'];
    let call = 0;
    const requestHandler = vi.fn(() => {
      const index = call++;
      return new Promise<Response>((resolve) => {
        setTimeout(
          () => {
            resolve(new Response(JSON.stringify({ id: '1', title: bodies[index] })));
          },
          index === 0 ? 40 : 5,
        );
      });
    });
    const seen: string[] = [];
    const onMessage = subscribe({
      apiRoute: '/api',
      callback: (data: { title?: string }) => {
        if (typeof data.title === 'string') seen.push(data.title);
      },
      depth: 1,
      initialData: { id: '1', title: 'From the server' },
      requestHandler,
      serverURL: SERVER,
    });

    await Promise.all([
      onMessage(event({ data: { id: '1', title: 'first' } })),
      onMessage(event({ data: { id: '1', title: 'second' } })),
    ]);

    // Nothing aborts and nothing orders the results: the older request settles
    // last, so the preview ends on the value the editor already replaced.
    expect(seen).toEqual(['Second (fast)', 'First (slow)']);
    // `subscribe` registered this async listener; removing it needs the same
    // reference, which is not an `EventListener` by type.
    window.removeEventListener('message', onMessage as unknown as EventListener);
  });

  it('3. rejects instead of reporting when the request fails', async () => {
    const requestHandler = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(
      handleMessage({
        apiRoute: '/api',
        depth: 1,
        event: event({ data: { id: '1', title: 'Typed' } }),
        initialData: { id: '1', title: 'From the server' },
        requestHandler,
        serverURL: SERVER,
      }),
    ).rejects.toThrow('Failed to fetch');
    // In the hook this rejection has no handler: the listener is an async
    // function nobody awaits, so the page keeps the stale document and the
    // failure surfaces as an unhandled rejection.
  });

  it('4. turns a 403 error body into the document', async () => {
    const requestHandler = handlerReturning(
      { errors: [{ message: 'You are not allowed to perform this action' }] },
      403,
    );

    const result = (await handleMessage({
      apiRoute: '/api',
      depth: 1,
      event: event({ data: { id: '1', title: 'Typed' } }),
      initialData: { id: '1', title: 'From the server' },
      requestHandler,
      serverURL: SERVER,
    })) as { errors?: unknown; title?: string };

    // `mergeData` reads the body without looking at `response.ok`.
    expect(result.errors).toBeDefined();
    expect(result.title).toBeUndefined();
  });

  it('5. carries one document across two hooks on the same page', async () => {
    const requestHandler = handlerReturning({ id: '1', title: 'Merged' });
    const first = { id: '1', title: 'First document' };
    const second = { id: '2', title: 'Second document' };

    await handleMessage({
      apiRoute: '/api',
      depth: 1,
      event: event({ data: { id: '1', title: 'Typed' } }),
      initialData: first,
      requestHandler,
      serverURL: SERVER,
    });
    await handleMessage({
      apiRoute: '/api',
      depth: 1,
      event: event({ data: { id: '2', title: 'Typed' } }),
      initialData: second,
      requestHandler,
      serverURL: SERVER,
    });

    // The module-level `previousData` from the first document is passed as the
    // second one's `initialData`, and the endpoint is built from its id: the
    // second hook fetches the first hook's document. (The first call here is a
    // priming one for the same reason — the cache is module-level, so whatever
    // an earlier merge in this process left behind is still in it.)
    const endpoints = requestHandler.mock.calls.map((call) => call[0].endpoint);
    expect(endpoints[1]).toBe('pages/1');
    expect(endpoints[1]).not.toBe(`pages/${second.id}`);
  });
});
