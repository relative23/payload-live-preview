import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RouteOutcome, RouteStrategy, StrategyHandlers } from '@core/strategies';
import type { FieldRenderer } from '@core/types';
import type { LivePreviewEventMap } from '@events/types';
import { fragmentStrategyFrom, type FragmentOutcome } from '@fragment/index';
import type { IslandUpdateDetail } from '@core/islands';
import { deferred, fireMessage, IO, TRUSTED, textRenderer } from './lifecycle-harness';

/**
 * ADR 0023: one display state per accepted revision. `revisions.completed`
 * said the writes landed and no boundary was pending, which is also true of a
 * revision whose boundary fell back to a patch, whose route showed the saved
 * draft or whose island never rendered it. The state names each of those.
 */

type Display = LivePreviewEventMap['revisionDisplay'];
type Options = ConstructorParameters<typeof LivePreviewRuntime>[0];

interface Harness {
  readonly runtime: LivePreviewRuntime;
  readonly events: Display[];
}

function start(html: string, overrides: Partial<Options> = {}): Harness {
  document.body.innerHTML = html;
  const emitter = new EventEmitter();
  const events: Display[] = [];
  emitter.on('revisionDisplay', (event) => {
    events.push(event);
  });
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
  runtime.start();
  return { runtime, events };
}

async function send(
  fields: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data: fields, ...extra });
  await vi.advanceTimersByTimeAsync(50);
}

const display = (runtime: LivePreviewRuntime) => runtime.inspect().revisions.display;

function fragments(outcome: (id: string, call: number) => FragmentOutcome): StrategyHandlers {
  let calls = 0;
  return {
    fragment: fragmentStrategyFrom((_request, boundary) => {
      calls += 1;
      return Promise.resolve(outcome(boundary.id, calls));
    }),
  };
}

function route(outcomes: readonly RouteOutcome[], retryMs?: number): RouteStrategy {
  let call = 0;
  return {
    plan: () => true,
    refresh: (context) => {
      const outcome = outcomes[Math.min(call, outcomes.length - 1)] ?? 'partial';
      call += 1;
      if (outcome === 'refused' && retryMs !== undefined) context.retryAfter?.(retryMs);
      return Promise.resolve(outcome);
    },
  };
}

const BOUND = '<h1 data-payload-field="title">T</h1>';
const TWO_BOUNDARIES =
  BOUND +
  '<section data-payload-fragment="a" data-payload-depends="a"><p>a</p></section>' +
  '<section data-payload-fragment="b" data-payload-depends="b"><p>b</p></section>';

describe('a revision the page shows completely', () => {
  it('is pending until its writes land, then current, and says so once', async () => {
    const { runtime, events } = start(BOUND);
    expect(display(runtime)).toBeUndefined();
    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    expect(display(runtime)?.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(50);
    expect(display(runtime)).toMatchObject({
      state: 'current',
      shortfalls: [],
      deferred: 0,
      awaitingIslands: 0,
    });
    expect(events.map((event) => event.state)).toEqual(['current']);
    expect(events[0]?.revision).toBe(display(runtime)?.revision);
    runtime.destroy();
  });

  it('counts writes the visibility gate holds as landed, and reports their number', async () => {
    const { runtime } = start(BOUND + '<p data-payload-field="note">N</p>', {
      disableVisibilityGate: false,
      visibilityGateThreshold: 0,
    });
    await send({ title: 'A', note: 'B' });
    expect(IO.latest).toBeDefined();
    expect(display(runtime)).toMatchObject({ state: 'current', deferred: 2 });
    runtime.destroy();
  });
});

describe('a revision that falls short', () => {
  it('names the boundary that fell back to a patch beside the one that rendered', async () => {
    const { runtime, events } = start(TWO_BOUNDARIES, {
      strategies: fragments((id) =>
        id === 'a'
          ? { status: 'rendered', html: '<p>a2</p>' }
          : { status: 'failed', code: 'LP0801', reason: 'timed out' },
      ),
    });
    await send({ title: 'T', a: 1, b: 1 });
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'fragment', id: 'b', key: undefined, code: 'LP0801' }],
    });
    expect(events.at(-1)?.state).toBe('partial');
    runtime.destroy();
  });

  it('names an expired authorization, and the next revision recovers', async () => {
    const { runtime, events } = start(TWO_BOUNDARIES, {
      strategies: fragments((_id, call) =>
        call <= 2
          ? { status: 'failed', code: 'LP0803', reason: 'endpoint refused the preview (401)' }
          : { status: 'rendered', html: '<p>ok</p>' },
      ),
    });
    await send({ title: 'T', a: 1, b: 1 });
    expect(
      display(runtime)?.shortfalls.map(
        (shortfall) => shortfall.kind === 'fragment' && shortfall.code,
      ),
    ).toEqual(['LP0803', 'LP0803']);
    await send({ title: 'T', a: 2, b: 2 });
    expect(display(runtime)).toMatchObject({ state: 'current', shortfalls: [] });
    expect(events.map((event) => event.state)).toEqual(['partial', 'current']);
    runtime.destroy();
  });

  it('names a route render that shows the saved draft', async () => {
    const { runtime } = start(BOUND, { strategies: { route: route(['partial']) } });
    await send({ title: 'A' });
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'route-saved' }],
    });
    runtime.destroy();
  });

  it('names a route refresh that failed', async () => {
    const { runtime } = start(BOUND, { strategies: { route: route(['failed']) } });
    await send({ title: 'A' });
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'route-failed', outcome: 'failed' }],
    });
    runtime.destroy();
  });

  it('stays pending while a refused refresh waits for its window, and settles when it runs', async () => {
    const { runtime, events } = start(BOUND, {
      strategies: { route: route(['refused', 'partial'], 1_000) },
    });
    await send({ title: 'A' });
    expect(document.querySelector('h1')?.textContent).toBe('A');
    expect(display(runtime)?.state).toBe('pending');
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'route-saved' }],
    });
    runtime.destroy();
  });

  it('names a patch that fell short and was kept, on every revision it recurs', async () => {
    // No renderer for the binding's type: the element keeps the server's markup.
    const { runtime, events } = start(
      '<p data-payload-field="price" data-payload-type="shop:missing">1</p>',
      {
        onUnfaithfulPatch: 'warn',
      },
    );
    await send({ price: 2 });
    await send({ price: 3 });
    expect(events.map((event) => event.state)).toEqual(['partial', 'partial']);
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'unfaithful', field: 'price' }],
    });
    runtime.destroy();
  });

  it('names a changed field with nowhere to land that was not escalated', async () => {
    const { runtime } = start(BOUND, { onUnfaithfulPatch: 'warn' });
    await send({ title: 'A', tagline: 'x' });
    await send({ title: 'A', tagline: 'y' });
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'unbound', field: 'tagline' }],
    });
    runtime.destroy();
  });

  it('names a write that did not happen because the renderer threw', async () => {
    const throwing: FieldRenderer = {
      name: 'text',
      render: () => {
        throw new Error('boom');
      },
    };
    const { runtime } = start(BOUND, { renderers: { text: throwing } });
    await send({ title: 'A' });
    expect(display(runtime)).toMatchObject({
      state: 'partial',
      shortfalls: [{ kind: 'write', field: 'title', code: 'LP0603' }],
    });
    runtime.destroy();
  });

  it('names a populated re-fetch that failed', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('nope', { status: 500 }));
    const { runtime } = start(BOUND + '<span data-payload-field="venue.title"></span>', {
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn },
    });
    await send({ id: '1', title: 'A', venue: 'v1' }, { collectionSlug: 'posts' });
    expect(fetchFn).toHaveBeenCalled();
    expect(display(runtime)).toMatchObject({ state: 'partial', shortfalls: [{ kind: 'merge' }] });
    runtime.destroy();
  });

  it('announces a partial revision once in the live region', async () => {
    const { runtime } = start(BOUND, {
      strategies: { route: route(['partial']) },
      enableA11y: true,
      a11yLocale: 'en',
    });
    await send({ title: 'A' });
    const region = document.querySelector('[aria-live]');
    expect(region?.textContent).toContain('Preview partly updated');
    runtime.destroy();
  });
});

describe('a revision a newer one replaces', () => {
  it('is reported superseded when it had not settled, and the newer one settles on its own', async () => {
    const first = deferred<FragmentOutcome>();
    let call = 0;
    const { runtime, events } = start(TWO_BOUNDARIES, {
      strategies: {
        fragment: fragmentStrategyFrom(() => {
          call += 1;
          return call <= 2
            ? first.promise
            : Promise.resolve({ status: 'rendered', html: '<p>ok</p>' });
        }),
      },
    });
    fireMessage({ type: 'payload-live-preview', data: { title: 'T', a: 1, b: 1 } });
    await vi.advanceTimersByTimeAsync(10);
    const firstRevision = display(runtime)?.revision;
    expect(display(runtime)?.state).toBe('pending');
    await send({ title: 'T', a: 2, b: 2 });
    first.resolve({ status: 'rendered', html: '<p>late</p>' });
    await vi.advanceTimersByTimeAsync(50);
    expect(events[0]).toMatchObject({ revision: firstRevision, state: 'superseded' });
    expect(display(runtime)).toMatchObject({ state: 'current' });
    expect(display(runtime)?.revision).not.toBe(firstRevision);
    runtime.destroy();
  });
});

describe('a revision handed to an island', () => {
  const ISLAND = BOUND + '<div data-payload-island="x"><p data-payload-field="title">T</p></div>';

  function listen(): IslandUpdateDetail[] {
    const received: IslandUpdateDetail[] = [];
    document
      .querySelector('[data-payload-island]')
      ?.addEventListener('payload-live-preview:update', (event) => {
        received.push((event as CustomEvent<IslandUpdateDetail>).detail);
      });
    return received;
  }

  it('is unconfirmed until the island says it rendered it, then current', async () => {
    const { runtime, events } = start(ISLAND);
    const received = listen();
    await send({ title: 'A' });
    expect(received).toHaveLength(1);
    expect(display(runtime)).toMatchObject({ state: 'unconfirmed', awaitingIslands: 1 });
    received[0]?.displayed();
    expect(display(runtime)).toMatchObject({ state: 'current', awaitingIslands: 0 });
    received[0]?.displayed();
    expect(events.map((event) => event.state)).toEqual(['unconfirmed', 'current']);
    runtime.destroy();
  });

  it("ignores a superseded revision's late confirmation", async () => {
    const { runtime } = start(ISLAND);
    const received = listen();
    await send({ title: 'A' });
    await send({ title: 'B' });
    expect(received).toHaveLength(2);
    received[0]?.displayed();
    expect(display(runtime)).toMatchObject({ state: 'unconfirmed', awaitingIslands: 1 });
    received[1]?.displayed();
    expect(display(runtime)?.state).toBe('current');
    runtime.destroy();
  });
});
