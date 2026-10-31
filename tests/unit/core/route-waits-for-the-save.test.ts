/**
 * `routeStrategy: 'after-save'`: the route answers for what is saved, so a GET
 * before the save shows nothing the editor typed and only costs a server render.
 * With this setting the runtime asks once Payload reports the save.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildBuiltinRenderers } from '@field-types/index';
import type { RouteStrategy } from '@core/strategies';
import type { LivePreviewRuntime } from '@core/lifecycle';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

function fakeRoute(): RouteStrategy & { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<'partial'> => {
      strategy.refreshes += 1;
      return Promise.resolve('partial' as const);
    },
  };
  return strategy;
}

function start(route: RouteStrategy, routeAfterSave: boolean): LivePreviewRuntime {
  document.body.innerHTML = '<h1 data-payload-field="title">Title</h1>';
  const runtime = makeRuntime({
    renderers: buildBuiltinRenderers(),
    strategies: { route },
    warn: () => {},
    ...(routeAfterSave ? { routeAfterSave } : {}),
  });
  runtime.start();
  return runtime;
}

async function type(...subtitles: string[]): Promise<void> {
  for (const subtitle of subtitles) {
    fireMessage({ type: 'payload-live-preview', data: { title: 'Title', subtitle } });
    await vi.advanceTimersByTimeAsync(1_200);
  }
}

async function save(): Promise<void> {
  fireMessage({ type: 'payload-document-event', action: 'updated' });
  await vi.advanceTimersByTimeAsync(100);
}

describe("routeStrategy: 'after-save'", () => {
  it('renders the route once after the save, and not for each edit before it', async () => {
    const route = fakeRoute();
    const runtime = start(route, true);
    await type('a', 'b', 'c');
    expect(route.refreshes).toBe(0);
    await save();
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('renders nothing for a save with no such edit before it', async () => {
    const route = fakeRoute();
    const runtime = start(route, true);
    await type('a');
    await save();
    expect(route.refreshes).toBe(0);
    await type('b');
    await save();
    await save();
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });

  it('asks again for the edits after that save', async () => {
    const route = fakeRoute();
    const runtime = start(route, true);
    await type('a', 'b');
    await save();
    await type('c');
    expect(route.refreshes).toBe(1);
    await save();
    expect(route.refreshes).toBe(2);
    runtime.destroy();
  });

  it('says the revision waits for the save', async () => {
    const route = fakeRoute();
    const runtime = start(route, true);
    await type('a', 'b');
    expect(runtime.inspect().route.refreshes).toBe(0);
    expect(runtime.inspect().revisions.display?.shortfalls).toEqual([{ kind: 'route-saved' }]);
    runtime.destroy();
  });

  it('without it, an edit still renders the route at once', async () => {
    const route = fakeRoute();
    const runtime = start(route, false);
    await type('a', 'b');
    expect(route.refreshes).toBe(1);
    runtime.destroy();
  });
});
