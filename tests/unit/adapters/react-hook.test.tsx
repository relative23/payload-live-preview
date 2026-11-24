import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLivePreviewDocument, type UseLivePreviewDocumentOptions } from '@adapters/react/index';
import type { PreviewDocument } from '@adapters/shared/document-session';

/**
 * The hook itself: that it subscribes once, re-renders the tree with the merged
 * document, and gives a component the three things it needs to render honestly
 * — the data, whether a merge is in flight, and whether the last one failed.
 * What the merge itself does is asserted in `document-session.test.ts`.
 */

const ADMIN = 'https://admin.example.com';
const SERVER = 'https://cms.example.com';

interface Page extends Record<string, unknown> {
  id: string;
  title: string;
}

const INITIAL: Page = { id: '1', title: 'From the server' };

function update(title: string, id = '1'): MessageEvent {
  return new MessageEvent('message', {
    origin: ADMIN,
    source: window.parent,
    data: {
      type: 'payload-live-preview',
      collectionSlug: 'pages',
      data: { id, title },
    },
  });
}

interface PreviewProps {
  readonly fetchFn: typeof fetch;
  readonly initialData?: Page;
  readonly serverURL?: string;
  readonly target?: Window;
  readonly document?: PreviewDocument;
  readonly timeoutMs?: number;
}

function Preview({
  fetchFn,
  initialData = INITIAL,
  serverURL = SERVER,
  target,
  document,
  timeoutMs,
}: PreviewProps): React.JSX.Element {
  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    initialData,
    fetchFn,
    ...(target === undefined ? {} : { target }),
    ...(document === undefined ? {} : { document }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return (
    <article>
      <h1 data-testid="title">{data.title}</h1>
      <p data-testid="status">{status}</p>
      <p data-testid="loading">{String(isLoading)}</p>
      <p data-testid="error">{error?.message ?? ''}</p>
    </article>
  );
}

type Connection = Partial<Omit<UseLivePreviewDocumentOptions<Page>, 'initialData' | 'fetchFn'>>;

/** The hook with any connection options on top of the ones every case here shares. */
function Probe({
  connection,
  initialData,
  fetchFn,
}: {
  readonly connection: Connection;
  readonly initialData: Page;
  readonly fetchFn: typeof fetch;
}): React.JSX.Element {
  const { data } = useLivePreviewDocument<Page>({
    serverURL: SERVER,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    initialData,
    fetchFn,
    ...connection,
  });
  return <h1 data-testid="title">{data.title}</h1>;
}

/**
 * Each row changes one connection option. A session keeps its merged document
 * for as long as it lives, so the page showing the new initial data is what
 * says a new session started.
 */
const CONNECTION_CHANGES: readonly [name: string, before: Connection, after: Connection][] = [
  ['the route prefix', {}, { apiRoute: '/cms-api' }],
  ['the depth', { depth: 1 }, { depth: 2 }],
  ['requireLocale', {}, { requireLocale: true }],
  ['referrer detection', {}, { enableReferrerDetection: true }],
  ['localhost matching', {}, { enableLocalhostMatching: false }],
  [
    'the document from a collection to a global',
    { document: { collection: 'pages', id: '1' } },
    { document: { global: 'pages' } },
  ],
  [
    'the locale of the document',
    { document: { collection: 'pages', id: '1' } },
    { document: { collection: 'pages', id: '1', locale: 'de' } },
  ],
];

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      }),
    );
}

function messageTarget(): Window {
  const target = new EventTarget() as unknown as Window;
  Object.defineProperties(target, {
    parent: { value: target },
    opener: { value: null },
  });
  return target;
}

/** One macrotask: the merge is a promise chain, not a timer. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

afterEach(() => {
  cleanup();
});

describe('useLivePreviewDocument', () => {
  it('renders the initial document, then the merged one', async () => {
    render(<Preview fetchFn={respondWith({ id: '1', title: 'Merged' })} />);
    expect(screen.getByTestId('title').textContent).toBe('From the server');
    expect(screen.getByTestId('status').textContent).toBe('idle');
    expect(screen.getByTestId('loading').textContent).toBe('true');

    await act(async () => {
      window.dispatchEvent(update('Typed in the admin'));
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTestId('title').textContent).toBe('Merged');
    expect(screen.getByTestId('status').textContent).toBe('live');
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('keeps the document and reports the failure when a merge does not land', async () => {
    const fetchFn = (() =>
      Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch;
    render(<Preview fetchFn={fetchFn} />);

    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTestId('title').textContent).toBe('From the server');
    expect(screen.getByTestId('status').textContent).toBe('unavailable');
    expect(screen.getByTestId('error').textContent).toContain('Failed to fetch');
  });

  it('reports which message its data came from, for an effect to compare after the commit', async () => {
    // ADR 0023: `status` is the merge; the paint is React's. An effect runs
    // after the commit, so what it reads is what the editor sees.
    const painted: [number, string][] = [];
    function Painted({ fetchFn }: { readonly fetchFn: typeof fetch }): React.JSX.Element {
      const { data, revision } = useLivePreviewDocument<Page>({
        serverURL: SERVER,
        allowedOrigins: [ADMIN],
        eventSourcePolicy: 'any',
        initialData: INITIAL,
        fetchFn,
      });
      useEffect(() => {
        painted.push([revision, screen.getByTestId('title').textContent]);
      }, [revision]);
      return <h1 data-testid="title">{data.title}</h1>;
    }
    let fail = false;
    const fetchFn = ((...args: Parameters<typeof fetch>) =>
      fail
        ? Promise.reject(new TypeError('Failed to fetch'))
        : respondWith({ id: '1', title: 'Merged' })(...args)) as typeof fetch;
    render(<Painted fetchFn={fetchFn} />);
    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();
    fail = true;
    await act(async () => {
      window.dispatchEvent(update('Typed again'));
      await Promise.resolve();
    });
    await settle();
    expect(painted).toEqual([
      [0, 'From the server'],
      [1, 'Merged'],
    ]);
  });

  it('subscribes once under strict mode, where every effect runs twice', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(
      <StrictMode>
        <Preview fetchFn={fetchFn as unknown as typeof fetch} />
      </StrictMode>,
    );

    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();

    // Two listeners would merge the same message twice, and the second request
    // would abort the first — visible as a superseded merge and a flicker.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('title').textContent).toBe('Merged');
  });

  it('stops listening when the component unmounts', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const view = render(<Preview fetchFn={fetchFn as unknown as typeof fetch} />);
    view.unmount();

    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('keeps the merged document across a re-render with a new initialData object', async () => {
    const fetchFn = respondWith({ id: '1', title: 'Merged' });
    const view = render(<Preview fetchFn={fetchFn} />);

    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('title').textContent).toBe('Merged');

    // A parent re-render hands the hook a fresh `initialData` identity; the
    // session is keyed on the connection, not on that object.
    view.rerender(<Preview fetchFn={fetchFn} />);

    expect(screen.getByTestId('title').textContent).toBe('Merged');
  });

  it('merges only the updates for its document, and starts a new session when the document changes', async () => {
    const fetchFn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { data: Page };
      return Promise.resolve(
        new Response(JSON.stringify(body.data), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    const view = render(
      <Preview
        fetchFn={fetchFn as unknown as typeof fetch}
        document={{ collection: 'pages', id: '1' }}
      />,
    );
    await act(async () => {
      window.dispatchEvent(update('For page two', '2'));
      await Promise.resolve();
    });
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(screen.getByTestId('title').textContent).toBe('From the server');

    view.rerender(
      <Preview
        fetchFn={fetchFn}
        document={{ collection: 'pages', id: '2' }}
        initialData={{ id: '2', title: 'Page two' }}
      />,
    );
    expect(screen.getByTestId('title').textContent).toBe('Page two');
    await act(async () => {
      window.dispatchEvent(update('Typed into two', '2'));
      await Promise.resolve();
    });
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('title').textContent).toBe('Typed into two');
  });

  it('reports an update unavailable once its merge outlives timeoutMs', async () => {
    const hanging = (() => new Promise<Response>(() => undefined)) as typeof fetch;
    render(<Preview fetchFn={hanging} timeoutMs={20} />);
    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(screen.getByTestId('status').textContent).toBe('unavailable');
    expect(screen.getByTestId('error').textContent).toBe(
      'live preview: the server did not answer within 20 ms',
    );
    expect(screen.getByTestId('title').textContent).toBe('From the server');
  });

  it('moves its listener when the target connection option changes', async () => {
    const firstTarget = messageTarget();
    const secondTarget = messageTarget();
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const view = render(
      <Preview fetchFn={fetchFn as unknown as typeof fetch} target={firstTarget} />,
    );

    view.rerender(<Preview fetchFn={fetchFn} target={secondTarget} />);

    await act(async () => {
      firstTarget.dispatchEvent(update('Old target'));
      await Promise.resolve();
    });
    await settle();
    expect(fetchFn).not.toHaveBeenCalled();

    await act(async () => {
      secondTarget.dispatchEvent(update('New target'));
      await Promise.resolve();
    });
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('title').textContent).toBe('Merged');
  });

  it('ignores an old response after a connection switch on the same window', async () => {
    const pageA: Page = { id: '1', title: 'Page A' };
    const pageB: Page = { id: '2', title: 'Page B' };
    let resolveOld: ((response: Response) => void) | undefined;
    let oldSignal: AbortSignal | null | undefined;
    const oldFetch = vi.fn((_url: string, init?: RequestInit) => {
      oldSignal = init?.signal;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    });
    const newFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '2', title: 'Page B live' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const view = render(
      <Preview
        fetchFn={oldFetch as unknown as typeof fetch}
        initialData={pageA}
        serverURL="https://cms-a.example.com"
      />,
    );

    await act(async () => {
      window.dispatchEvent(update('Page A edit'));
      await Promise.resolve();
    });
    expect(oldFetch).toHaveBeenCalledTimes(1);

    view.rerender(
      <Preview fetchFn={newFetch} initialData={pageB} serverURL="https://cms-b.example.com" />,
    );
    expect(oldSignal?.aborted).toBe(true);
    expect(screen.getByTestId('title').textContent).toBe('Page B');

    await act(async () => {
      window.dispatchEvent(update('Page B edit', '2'));
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('title').textContent).toBe('Page B live');

    await act(async () => {
      resolveOld?.(
        new Response(JSON.stringify({ id: '1', title: 'Late Page A' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('title').textContent).toBe('Page B live');
  });

  it('uses a new strict-mode session when the caller keys a document switch', async () => {
    const pageA: Page = { id: '1', title: 'Page A' };
    const pageB: Page = { id: '2', title: 'Page B' };
    let resolveOld: ((response: Response) => void) | undefined;
    const oldFetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const newFetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '2', title: 'Page B live' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    const view = render(
      <StrictMode>
        <Preview key="page-a" fetchFn={oldFetch as unknown as typeof fetch} initialData={pageA} />
      </StrictMode>,
    );

    await act(async () => {
      window.dispatchEvent(update('Page A edit'));
      await Promise.resolve();
    });
    expect(oldFetch).toHaveBeenCalledTimes(1);

    view.rerender(
      <StrictMode>
        <Preview key="page-b" fetchFn={newFetch} initialData={pageB} />
      </StrictMode>,
    );
    expect(screen.getByTestId('title').textContent).toBe('Page B');

    await act(async () => {
      resolveOld?.(
        new Response(JSON.stringify({ id: '1', title: 'Late Page A' }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId('title').textContent).toBe('Page B');

    await act(async () => {
      window.dispatchEvent(update('Page B edit', '2'));
      await Promise.resolve();
    });
    await settle();
    expect(newFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('title').textContent).toBe('Page B live');
  });

  it.each(CONNECTION_CHANGES)(
    'starts a new session on a change of %s',
    async (_name, before, after) => {
      const fetchFn = respondWith({ id: '1', title: 'Merged' });
      const view = render(<Probe connection={before} initialData={INITIAL} fetchFn={fetchFn} />);
      await act(async () => {
        window.dispatchEvent(update('Typed'));
        await Promise.resolve();
      });
      await settle();
      expect(screen.getByTestId('title').textContent).toBe('Merged');

      view.rerender(
        <Probe
          connection={after}
          initialData={{ id: '1', title: 'Fresh start' }}
          fetchFn={fetchFn}
        />,
      );

      expect(screen.getByTestId('title').textContent).toBe('Fresh start');
    },
  );

  it('sends the merge to the route prefix and with the depth it was given', async () => {
    const fetchFn = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '1', title: 'Merged' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    render(
      <Probe
        connection={{ apiRoute: '/cms-api', depth: 3 }}
        initialData={INITIAL}
        fetchFn={fetchFn as unknown as typeof fetch}
      />,
    );
    await act(async () => {
      window.dispatchEvent(update('Typed'));
      await Promise.resolve();
    });
    await settle();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://cms.example.com/cms-api/pages/1');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toMatchObject({
      depth: 3,
    });
  });
});
