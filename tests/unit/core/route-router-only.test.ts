/**
 * `routeStrategy: 'router'`, the default of the Next.js, SvelteKit and Nuxt
 * adapters since 3.0 (ADR 0007, row 40): the route belongs to the framework's
 * router. A change no patch can show is handed to the route refresh the page
 * lent, after Payload reports the save, and to nothing else: a page that lent
 * none is not fetched and morphed in the router's place. Measured before the
 * default was set: on a Next.js page the morph removes the router's own
 * `<next-route-announcer>` from the body.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlyWhileLent } from '@core/strategies/lent-route';
import { registerRouteRefresh } from '@core/strategies/route-refresh';
import type { RouteOutcome, RouteStrategy } from '@core/strategies/strategies';
import type { LivePreviewRuntime } from '@core/session/lifecycle';
import { fireMessage, makeRuntime } from './lifecycle-startup-harness';

/** Stands in for the route prelude: counts the refreshes the runtime asks of it. */
function fakeRoute(): RouteStrategy & { refreshes: number } {
  const strategy = {
    refreshes: 0,
    plan: (): boolean => false,
    refresh: (): Promise<RouteOutcome> => {
      strategy.refreshes += 1;
      return Promise.resolve('refreshed');
    },
  };
  return strategy;
}

let undo: (() => void) | undefined;
let runtime: LivePreviewRuntime | undefined;
let warnings: string[] = [];

function start(route: RouteStrategy): LivePreviewRuntime {
  document.body.innerHTML = '<h1 data-payload-field="title">Server rendered</h1>';
  warnings = [];
  runtime = makeRuntime({
    strategies: { route },
    routeAfterSave: true,
    routeLentOnly: true,
    warn: (line) => {
      warnings.push(String(line));
    },
  });
  runtime.start();
  return runtime;
}

async function send(data: Record<string, unknown>): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data });
  await vi.advanceTimersByTimeAsync(50);
}

async function saved(): Promise<void> {
  fireMessage({ type: 'payload-document-event', action: 'updated' });
  await vi.advanceTimersByTimeAsync(50);
}

/** The connection's first message, then an edit of a field the page does not bind, then the save. */
async function editUnboundAndSave(callout: string): Promise<void> {
  await send({ title: 'Server rendered', callout: 'saved callout' });
  await send({ title: 'Server rendered', callout });
  await saved();
}

afterEach(() => {
  undo?.();
  undo = undefined;
  runtime?.destroy();
  runtime = undefined;
});

describe("a route that belongs to the framework's router", () => {
  it('is not refreshed on a page that lent no route refresh, which is told what to mount', async () => {
    const route = fakeRoute();
    const started = start(route);

    await editUnboundAndSave('typed');

    expect(route.refreshes).toBe(0);
    const { route: stats, fidelity } = started.inspect();
    expect({ handler: stats.handler, canEscalate: fidelity.canEscalate }).toEqual({
      handler: false,
      canEscalate: false,
    });
    expect(warnings.filter((line) => line.includes('LP0808'))).toEqual([
      "[live-preview] LP0808: onUnfaithfulPatch: 'escalate' has nowhere to go: 1 field(s) fell short " +
        'and the page lent no route refresh: render LivePreviewNavigation (Next.js) or call ' +
        "livePreviewNavigation() (SvelteKit), or onUnfaithfulPatch: 'warn' to keep the patch and say so.",
    ]);
  });

  it('is refreshed through the strategy once the page lent one, and only after the save', async () => {
    const route = fakeRoute();
    const started = start(route);
    undo = registerRouteRefresh(() => Promise.resolve());

    await send({ title: 'Server rendered', callout: 'saved callout' });
    await send({ title: 'Server rendered', callout: 'typed' });
    expect(route.refreshes).toBe(0);

    await saved();

    expect(route.refreshes).toBe(1);
    expect(started.inspect().route.handler).toBe(true);
    expect(warnings.filter((line) => line.includes('LP0808'))).toEqual([]);
  });

  it('is not fetched by a run that comes after the page took its refresh back', async () => {
    // What a trailing run holds: the strategy as it was handed out while a refresh was lent.
    const route = fakeRoute();
    const lent = registerRouteRefresh(() => Promise.resolve());
    const held = onlyWhileLent({ route }, true).route;
    lent();

    const outcome = await held?.refresh({
      revision: 1,
      receivedAt: 0,
      signal: new AbortController().signal,
      isCurrent: () => true,
      log: () => {},
    });

    expect({ outcome, refreshes: route.refreshes }).toEqual({ outcome: 'failed', refreshes: 0 });
  });

  it("is the strategy as given where the route is not the router's alone", () => {
    const route = fakeRoute();

    expect(onlyWhileLent({ route }, false).route).toBe(route);
  });

  it('is left alone again when the page takes its refresh back', async () => {
    const route = fakeRoute();
    start(route);
    const lent = registerRouteRefresh(() => Promise.resolve());
    await editUnboundAndSave('typed');
    expect(route.refreshes).toBe(1);

    lent();
    await send({ title: 'Server rendered', callout: 'typed again' });
    await saved();

    expect(route.refreshes).toBe(1);
  });
});
