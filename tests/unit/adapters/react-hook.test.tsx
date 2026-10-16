import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLivePreviewDocument } from '@adapters/react/index';

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
}

function Preview({
  fetchFn,
  initialData = INITIAL,
  serverURL = SERVER,
  target,
}: PreviewProps): React.JSX.Element {
  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    initialData,
    fetchFn,
    ...(target === undefined ? {} : { target }),
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
});
