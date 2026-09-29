import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { IslandUpdateDetail } from '@core/islands';
import type { FragmentStrategy, RouteOutcome, RouteStrategy } from '@core/strategies';
import type { LivePreviewEventMap } from '@events/types';
import { fragmentStrategyFrom, type FragmentOutcome } from '@fragment/index';
import { deferred, fireMessage, TRUSTED, textRenderer } from './lifecycle-harness';
import { mergingFetch, relationshipRenderer } from './populating-server-harness';

/**
 * ADR 0023, path by path: every place that decides whether a revision is
 * still outstanding, and every shortfall the pipeline can record, each with
 * the case that tells it apart from its neighbours.
 */

type Display = LivePreviewEventMap['revisionDisplay'];
type Options = ConstructorParameters<typeof LivePreviewRuntime>[0];

function start(html: string, overrides: Partial<Options> = {}) {
  document.body.innerHTML = html;
  const emitter = new EventEmitter();
  const events: Display[] = [];
  const runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    warn: () => {},
    ...overrides,
  });
  // Read at the moment of the report: what the page still had outstanding then.
  const pendingAtReport: number[] = [];
  emitter.on('revisionDisplay', (event) => {
    events.push(event);
    pendingAtReport.push(runtime.inspect().scheduler.pending);
  });
  runtime.start();
  const display = () => runtime.inspect().revisions.display;
  return { runtime, events, pendingAtReport, display };
}

async function send(
  fields: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data: fields, ...extra });
  await vi.advanceTimersByTimeAsync(50);
}

function route(outcome: RouteOutcome, plan: RouteStrategy['plan'] = () => true): RouteStrategy {
  return { plan, refresh: () => Promise.resolve(outcome) };
}

const BOUND = '<h1 data-payload-field="title">T</h1>';
const MISSING = '<p data-payload-field="price" data-payload-type="shop:missing">1</p>';

describe('what keeps a revision pending', () => {
  it('a route refresh in flight, even after the later revision wrote everything', async () => {
    const refresh = deferred<RouteOutcome>();
    const { runtime, display } = start(BOUND, {
      strategies: {
        route: { plan: (_root, changed) => changed.has('banner'), refresh: () => refresh.promise },
      },
    });
    await send({ title: 'A', banner: 'a' });
    await send({ title: 'B', banner: 'a' });
    expect(document.querySelector('h1')?.textContent).toBe('B');
    expect(display()?.state).toBe('pending');
    refresh.resolve('partial');
    await vi.advanceTimersByTimeAsync(50);
    expect(display()).toMatchObject({ state: 'partial', shortfalls: [{ kind: 'route-saved' }] });
    runtime.destroy();
  });

  it('a boundary an escalation started after the writes completed', async () => {
    const render = deferred<FragmentOutcome>();
    const { runtime, display } = start(
      `<section data-payload-fragment="a" data-payload-depends="other">${MISSING}</section>`,
      { strategies: { fragment: fragmentStrategyFrom(() => render.promise) } },
    );
    await send({ price: 2 });
    expect(display()?.state).toBe('pending');
    render.resolve({ status: 'rendered', html: '<p>2</p>' });
    await vi.advanceTimersByTimeAsync(50);
    expect(display()).toMatchObject({ state: 'current', shortfalls: [] });
    runtime.destroy();
  });

  it('the writes a route re-applies, which land before the revision settles', async () => {
    let call = 0;
    const { runtime, events, pendingAtReport } = start(BOUND, {
      strategies: {
        route: {
          plan: () => true,
          refresh: (context) => {
            call += 1;
            if (call > 1) return Promise.resolve('partial');
            context.retryAfter?.(1_000);
            return Promise.resolve('refused');
          },
        },
      },
    });
    await send({ title: 'A' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(events.map((event) => event.state)).toEqual(['partial']);
    expect(pendingAtReport).toEqual([0]);
    runtime.destroy();
  });
});

describe('what the route says', () => {
  it('a refresh that rendered the revision leaves nothing short', async () => {
    const { runtime, display } = start(BOUND, { strategies: { route: route('refreshed') } });
    await send({ title: 'A' });
    expect(display()).toMatchObject({ state: 'current', shortfalls: [] });
    runtime.destroy();
  });

  (['refused', 'superseded'] as const).forEach((outcome) => {
    it(`a refresh that ended ${outcome} with nothing to follow is a route that did not render`, async () => {
      const { runtime, display } = start(BOUND, { strategies: { route: route(outcome) } });
      await send({ title: 'A' });
      expect(display()).toMatchObject({
        state: 'partial',
        shortfalls: [{ kind: 'route-failed', outcome }],
      });
      runtime.destroy();
    });
  });
});

describe('a patch that stays as it is', () => {
  it('when nothing on the page can take the escalation', async () => {
    const { runtime, display } = start(MISSING);
    await send({ price: 2 });
    expect(display()).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'unfaithful', field: 'price' }],
    });
    runtime.destroy();
  });

  it('when the revision already refreshed the route', async () => {
    const { runtime, display } = start(MISSING, { strategies: { route: route('partial') } });
    await send({ price: 2 });
    expect(display()?.shortfalls).toEqual([
      { kind: 'route-saved' },
      { kind: 'unfaithful', field: 'price' },
    ]);
    runtime.destroy();
  });

  it('when an attribute write is refused', async () => {
    const { runtime, display } = start(
      '<a data-payload-field="handler" data-payload-attribute="onclick">x</a>',
    );
    await send({ handler: 'alert(1)' });
    expect(display()).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'write', field: 'handler', code: 'LP0401' }],
    });
    runtime.destroy();
  });
});

describe('a fragment strategy that threw', () => {
  it('names every boundary it held, with the key where there is one', async () => {
    const strategy: FragmentStrategy = {
      plan: (root) => [...(root as Document).body.querySelectorAll('section')],
      render: () => Promise.reject(new Error('strategy exploded')),
    };
    const { runtime, display } = start(
      '<section data-payload-fragment="a" data-payload-fragment-key="k1"></section>' +
        '<section data-payload-fragment="b" data-payload-fragment-key=""></section>' +
        '<section></section>',
      { strategies: { fragment: strategy } },
    );
    await send({ title: 'A' });
    expect(display()?.shortfalls).toEqual([
      { kind: 'fragment', id: 'a', key: 'k1', code: 'LP0801' },
      { kind: 'fragment', id: 'b', key: undefined, code: 'LP0801' },
      { kind: 'fragment', id: '', key: undefined, code: 'LP0801' },
    ]);
    runtime.destroy();
  });
});

describe('an island still hydrating', () => {
  it('owes the revision from the start, and confirms it once it has it', async () => {
    const { runtime, display } = start(
      `${BOUND}<astro-island ssr><p data-payload-field="title">T</p></astro-island>`,
    );
    const island = document.querySelector('astro-island');
    const received: IslandUpdateDetail[] = [];
    island?.addEventListener('payload-live-preview:update', (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    await send({ title: 'A' });
    expect(received).toEqual([]);
    expect(display()).toMatchObject({ state: 'unconfirmed', awaitingIslands: 1 });
    island?.removeAttribute('ssr');
    await vi.advanceTimersByTimeAsync(10);
    expect(received).toHaveLength(1);
    expect(display()?.awaitingIslands).toBe(1);
    received[0]?.displayed();
    expect(display()).toMatchObject({ state: 'current', awaitingIslands: 0 });
    runtime.destroy();
  });
});

describe('a merge a burst shares', () => {
  it('names the failed re-fetch on the revision that waited for it', async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('nope', { status: 500 })),
    );
    const { runtime, display } = start(
      '<a data-payload-field="venue" data-payload-type="relationship">no venue yet</a>',
      {
        debounceMs: 50,
        renderers: { text: textRenderer(), relationship: relationshipRenderer() },
        dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
      },
    );
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'T' },
    });
    await vi.advanceTimersByTimeAsync(30);
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'T', venue: 'venue-2' },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(display()?.shortfalls).toContainEqual({ kind: 'merge' });
    runtime.destroy();
  });

  it('names nothing when the shared re-fetch lands', async () => {
    const { runtime, display } = start(
      '<a data-payload-field="venue" data-payload-type="relationship">no venue yet</a>',
      {
        debounceMs: 50,
        renderers: { text: textRenderer(), relationship: relationshipRenderer() },
        dataMerge: {
          serverURL: 'https://cms.example.com',
          fetchFn: mergingFetch() as unknown as typeof fetch,
        },
      },
    );
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'T' },
    });
    await vi.advanceTimersByTimeAsync(30);
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'events',
      data: { id: 'event-1', title: 'T', venue: 'venue-2' },
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(display()).toMatchObject({ state: 'current', shortfalls: [] });
    runtime.destroy();
  });
});

describe('the announcement', () => {
  it('is left out without the live region, and the report still goes out', async () => {
    const { runtime, events } = start(BOUND, {
      enableA11y: false,
      strategies: { route: route('partial') },
    });
    await send({ title: 'A' });
    expect(events.map((event) => event.state)).toEqual(['partial']);
    expect(document.querySelector('[aria-live]')).toBeNull();
    runtime.destroy();
  });

  it('speaks German where the page does', async () => {
    const { runtime } = start(BOUND, { a11yLocale: 'de', strategies: { route: route('partial') } });
    await send({ title: 'A' });
    expect(document.querySelector('[aria-live]')?.textContent).toContain(
      'Vorschau teilweise aktualisiert',
    );
    runtime.destroy();
  });
});
