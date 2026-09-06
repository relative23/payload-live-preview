import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
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

function update(title: string): MessageEvent {
  return new MessageEvent('message', {
    origin: ADMIN,
    source: window.parent,
    data: {
      type: 'payload-live-preview',
      collectionSlug: 'pages',
      data: { id: '1', title },
    },
  });
}

function Preview({ fetchFn }: { fetchFn: typeof fetch }): React.JSX.Element {
  const { data, isLoading, status, error } = useLivePreviewDocument<Page>({
    serverURL: SERVER,
    allowedOrigins: [ADMIN],
    eventSourcePolicy: 'any',
    initialData: INITIAL,
    fetchFn,
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
});
