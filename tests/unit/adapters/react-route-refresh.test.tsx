import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewRouteRefresh } from '@adapters/react/index';
import { readRouteRefresh } from '@core/route-refresh';

/**
 * LP-6: the route strategy morphs fetched HTML into the living page, and on a
 * Next page that DOM belongs to React's reconciler — once seen as `removeChild`
 * on `null` in its commit phase. This component lends the runtime the router's
 * own refresh instead, and the strategy prefers it when it is there.
 *
 * What matters beyond "it registers" is that the promise it hands over settles
 * only after React has committed the new markup: the runtime re-applies the
 * revision on top of it, and doing that too early writes into nodes that are
 * about to be replaced.
 */

afterEach(() => {
  cleanup();
  (window as unknown as Record<string, unknown>)['__livePreviewRouteRefresh'] = undefined;
});

describe('LivePreviewRouteRefresh', () => {
  it('lends the router refresh while it is mounted and takes it back afterwards', () => {
    expect(readRouteRefresh()).toBeUndefined();
    const { unmount } = render(<LivePreviewRouteRefresh refresh={() => undefined} />);
    expect(readRouteRefresh()).toBeTypeOf('function');
    unmount();
    expect(readRouteRefresh()).toBeUndefined();
  });

  it('runs the router refresh and settles once the transition has committed', async () => {
    const refresh = vi.fn();
    render(<LivePreviewRouteRefresh refresh={refresh} />);
    let settled = false;
    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = Promise.resolve(readRouteRefresh()?.()).then(() => {
        settled = true;
      });
      await Promise.resolve();
    });
    // The refresh is asked for straight away; the promise is not the answer to
    // "was it called" but to "has React finished with it".
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await pending;
    });
    expect(settled).toBe(true);
  });

  it('releases a waiting runtime when the tree unmounts mid-refresh', async () => {
    const { unmount } = render(<LivePreviewRouteRefresh refresh={() => undefined} />);
    const lent = readRouteRefresh();
    let settled = false;
    let pending: Promise<void> | undefined;
    act(() => {
      pending = Promise.resolve(lent?.()).then(() => {
        settled = true;
      });
      unmount();
    });
    await pending;
    expect(settled).toBe(true);
  });

  it('hands the slot to the newer component and does not take it back for the older one', () => {
    const first = render(<LivePreviewRouteRefresh refresh={() => undefined} />);
    const second = render(<LivePreviewRouteRefresh refresh={() => undefined} />);
    const lent = readRouteRefresh();
    first.unmount();
    expect(readRouteRefresh()).toBe(lent);
    second.unmount();
    expect(readRouteRefresh()).toBeUndefined();
  });
});
