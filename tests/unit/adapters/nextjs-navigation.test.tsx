import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { readRouteRefresh } from '@core/route-refresh';

/**
 * `<LivePreviewNavigation />` replaces the App Router bridge a Next preview
 * copied from the guide: one navigation event per committed URL change, none
 * for the page the runtime started on, and the router's refresh lent to the
 * route strategy while it is mounted.
 */

interface RouterState {
  pathname: string | null;
  search: string | null;
  suspend: Promise<void> | undefined;
  refresh: () => void;
}

const router = vi.hoisted((): RouterState => ({
  pathname: '/a',
  search: 'x=1',
  suspend: undefined,
  refresh: () => undefined,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: router.refresh }),
  usePathname: () => router.pathname,
  useSearchParams: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- Suspense suspends on a thrown promise, as useSearchParams() does
    if (router.suspend !== undefined) throw router.suspend;
    return router.search === null ? null : new URLSearchParams(router.search);
  },
}));

const { LivePreviewNavigation } = await import('@adapters/nextjs/client');

let commits = 0;
const onCommit = (): void => {
  commits += 1;
};

beforeEach(() => {
  router.pathname = '/a';
  router.search = 'x=1';
  router.suspend = undefined;
  router.refresh = () => undefined;
  commits = 0;
  document.addEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
});

afterEach(() => {
  cleanup();
  document.removeEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
  (window as unknown as Record<string, unknown>)['__livePreviewRouteRefresh'] = undefined;
});

describe('LivePreviewNavigation', () => {
  it('says nothing for the page the runtime started on, under StrictMode too', () => {
    render(
      <StrictMode>
        <LivePreviewNavigation />
      </StrictMode>,
    );
    expect(commits).toBe(0);
  });

  it('dispatches once per committed pathname or query change, and not for a re-render', () => {
    const view = render(<LivePreviewNavigation />);
    router.pathname = '/b';
    view.rerender(<LivePreviewNavigation />);
    expect(commits).toBe(1);
    view.rerender(<LivePreviewNavigation />);
    expect(commits).toBe(1);
    router.search = 'x=2';
    view.rerender(<LivePreviewNavigation />);
    expect(commits).toBe(2);
  });

  it('takes the first URL it can name as the start, not as a navigation', () => {
    router.pathname = null;
    const view = render(<LivePreviewNavigation />);
    router.pathname = '/a';
    view.rerender(<LivePreviewNavigation />);
    expect(commits).toBe(0);
    router.pathname = '/b';
    view.rerender(<LivePreviewNavigation />);
    expect(commits).toBe(1);
  });

  it('lends the router refresh while mounted and takes it back on unmount', async () => {
    const refresh = vi.fn();
    router.refresh = refresh;
    const view = render(<LivePreviewNavigation />);
    const lent = readRouteRefresh();
    expect(lent).toBeTypeOf('function');
    let pending: Promise<void> | undefined;
    // React holds the transition until act's callback returns: start it in
    // one act and await its commit in the next, as the component's own test does.
    await act(async () => {
      pending = Promise.resolve(lent?.());
      await Promise.resolve();
    });
    await act(async () => {
      await pending;
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(readRouteRefresh()).toBeUndefined();
  });

  it('holds its own Suspense boundary while the search params suspend', async () => {
    let resume: () => void = () => undefined;
    router.suspend = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const view = render(<LivePreviewNavigation />);
    expect(view.container.innerHTML).toBe('');
    expect(readRouteRefresh()).toBeUndefined();
    router.suspend = undefined;
    await act(async () => {
      resume();
      await Promise.resolve();
    });
    expect(readRouteRefresh()).toBeTypeOf('function');
    expect(commits).toBe(0);
  });
});
