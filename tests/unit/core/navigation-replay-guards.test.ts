/**
 * Late DOM observations are allowed before any accepted snapshot exists.
 * Exercise that no-op synchronously so a missing guard is an assertion failure,
 * not an unhandled MutationObserver exception hidden behind runner diagnostics.
 */
import { describe, expect, it, vi } from 'vitest';
import { ElementCache } from '@core/cache';
import { ISLAND_EVENT } from '@core/islands';
import { NavigationReplay } from '@core/navigation-replay';
import { RuntimeState, type RuntimeDeps, type UpdateTransaction } from '@core/runtime-state';
import type { PayloadLivePreviewData } from '@/types/payload-protocol';

function transaction(fields: Record<string, unknown>): UpdateTransaction {
  return {
    revision: { generation: 1, revision: 1 },
    message: { type: 'payload-live-preview', collectionSlug: 'posts', data: fields },
    locale: undefined,
    schema: undefined,
    schemaIndex: undefined,
    receivedAt: 1,
    forceRender: false,
    countsAsUpdate: true,
    renderData: { fields, collectionSlug: 'posts' },
    fragmentBoundariesRun: new WeakSet(),
    touched: new Set(['title']),
    baseline: false,
    invalidated: new Set(),
    revealTarget: undefined,
    revealIdentities: [],
    pendingFragments: 0,
    routeRefreshed: false,
    cancelled: false,
    completed: false,
  };
}

function harness(markup: string) {
  document.body.innerHTML = markup;
  const cache = new ElementCache();
  cache.buildFromRoot(document.body);
  const state = new RuntimeState();
  state.started = true;
  state.navigationBindingReplay = true;
  const schedule = vi.fn();
  // The replay reads only these dependency ports; the typed pick keeps them honest.
  const ports: Pick<RuntimeDeps, 'cache' | 'scopeBindingsByOwner' | 'warn'> = {
    cache,
    scopeBindingsByOwner: true,
    warn: vi.fn(),
  };
  const replay = new NavigationReplay(ports as RuntimeDeps, state, { schedule });
  return { replay, state, schedule };
}

describe('NavigationReplay — empty and reentrant snapshots', () => {
  it.each([false, true])(
    'ignores an island observation without a transaction (hydrated=%s)',
    (hydrated) => {
      const { replay, schedule } = harness('<astro-island></astro-island>');
      const island = document.querySelector('astro-island')!;
      const receive = vi.fn();
      island.addEventListener(ISLAND_EVENT, receive);

      expect(() => replay.reapplyIslands([island], hydrated)).not.toThrow();

      expect(receive).not.toHaveBeenCalled();
      expect(schedule).not.toHaveBeenCalled();
    },
  );

  it('treats the default island observation as ordinary replay, not hydration completion', () => {
    const { replay, state } = harness(
      '<astro-island data-payload-owner="collection:posts:1"></astro-island>',
    );
    state.activeUpdate = transaction({ id: 1, title: 'unsaved' });
    const island = document.querySelector('astro-island')!;
    const receive = vi.fn();
    island.addEventListener(ISLAND_EVENT, receive);

    replay.reapplyIslands([island]);

    expect(receive).toHaveBeenCalledOnce();
    expect((receive.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
      fields: { id: 1, title: 'unsaved' },
      revision: 1,
    });
  });

  it('ignores an accepted transaction that has no rendered snapshot yet', () => {
    const { replay, state, schedule } = harness('<astro-island></astro-island>');
    state.activeUpdate = transaction({ id: 1 });
    state.activeUpdate.renderData = undefined;
    const island = document.querySelector('astro-island')!;
    const receive = vi.fn();
    island.addEventListener(ISLAND_EVENT, receive);

    expect(() => replay.reapplyIslands([island])).not.toThrow();
    replay.reapplyBindings(new Set([island]));

    expect(receive).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it('does not refresh for a late named route binding owned by another document', () => {
    const { replay, state } = harness(
      '<p data-payload-owner="collection:posts:2" data-payload-field="title" data-payload-strategy="route"></p>',
    );
    const current = transaction({ id: 1, title: 'unsaved' });
    state.activeUpdate = current;

    expect(
      replay.hasLateRouteBinding(
        new Set([document.querySelector('p')!]),
        ['collection:posts:1'],
        current,
        current.renderData!,
      ),
    ).toBe(false);
  });

  it('abandons a late route decision when reading its value supersedes the transaction', () => {
    const { replay, state } = harness(
      '<p data-payload-owner="collection:posts:1" data-payload-field="title" data-payload-strategy="route"></p>',
    );
    const current = transaction({ id: 1 });
    state.activeUpdate = current;
    const data: PayloadLivePreviewData = {
      fields: {
        get title() {
          state.activeUpdate = null;
          return 'stale';
        },
      },
    };

    expect(
      replay.hasLateRouteBinding(
        new Set([document.querySelector('p')!]),
        ['collection:posts:1'],
        current,
        data,
      ),
    ).toBe(false);
  });
});
