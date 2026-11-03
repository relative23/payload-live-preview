import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAVIGATION_COMMIT_EVENT } from '@core/navigation-lifecycle';
import { readRouteRefresh } from '@core/route-refresh';

/**
 * `livePreviewNavigation()` replaces the SvelteKit bridge a preview copied from
 * the guide. Svelte's lifecycle is stood in for: `onMount` collects its
 * callback, so a test can mount and unmount, and `tick` records when it ran.
 */

const lifecycle = vi.hoisted(() => ({
  mounted: [] as (() => (() => void) | undefined)[],
  order: [] as string[],
}));

vi.mock('svelte', () => ({
  onMount: (callback: () => (() => void) | undefined) => {
    lifecycle.mounted.push(callback);
  },
  tick: async () => {
    await Promise.resolve();
    lifecycle.order.push('tick');
  },
}));

const { livePreviewNavigation } = await import('@adapters/sveltekit/client');

type Callback = Parameters<Parameters<typeof livePreviewNavigation>[0]['afterNavigate']>[0];

let callbacks: Callback[];
let commits: number;
const onCommit = (): void => {
  commits += 1;
};

function setUp(invalidateAll: () => Promise<void> = () => Promise.resolve()): () => void {
  livePreviewNavigation({
    afterNavigate: (callback) => {
      callbacks.push(callback);
    },
    invalidateAll,
  });
  const cleanup = lifecycle.mounted.map((callback) => callback());
  return () => {
    for (const undo of cleanup) undo?.();
  };
}

beforeEach(() => {
  callbacks = [];
  commits = 0;
  lifecycle.mounted = [];
  lifecycle.order = [];
  document.addEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
});

afterEach(() => {
  document.removeEventListener(NAVIGATION_COMMIT_EVENT, onCommit);
  (window as unknown as Record<string, unknown>)['__livePreviewRouteRefresh'] = undefined;
});

describe('livePreviewNavigation', () => {
  it('says nothing for the mount call, which has no `from`', () => {
    setUp();
    callbacks[0]?.({ from: null, type: 'enter' });
    expect(commits).toBe(0);
  });

  it('dispatches for each committed navigation, on SvelteKit 2 and 3', () => {
    setUp();
    const from = { url: new URL('https://site.example/a') };
    callbacks[0]?.({ from, type: 'link' });
    callbacks[0]?.({ from, type: 'goto', shallow: false });
    callbacks[0]?.({ from, type: 'popstate', shallow: true });
    expect(commits).toBe(3);
  });

  it('leaves out a shallow goto, which keeps the rendered route', () => {
    setUp();
    callbacks[0]?.({
      from: { url: new URL('https://site.example/a') },
      type: 'goto',
      shallow: true,
    });
    expect(commits).toBe(0);
  });

  it('lends a refresh that settles after the loads and the next tick, and gives it back', async () => {
    const invalidateAll = vi.fn(async () => {
      await Promise.resolve();
      lifecycle.order.push('invalidateAll');
    });
    const unmount = setUp(invalidateAll);
    const lent = readRouteRefresh();
    expect(lent).toBeTypeOf('function');
    await lent?.();
    expect(lifecycle.order).toEqual(['invalidateAll', 'tick']);
    unmount();
    expect(readRouteRefresh()).toBeUndefined();
  });

  it('registers nothing before the component mounts', () => {
    livePreviewNavigation({
      afterNavigate: () => undefined,
      invalidateAll: () => Promise.resolve(),
    });
    expect(readRouteRefresh()).toBeUndefined();
  });
});
