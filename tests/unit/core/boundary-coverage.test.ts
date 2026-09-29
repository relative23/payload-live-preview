import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RouteStrategy, StrategyHandlers } from '@core/strategies';
import { fragmentStrategyFrom, type StrategyRequest } from '@fragment/index';
import { TRUSTED, fireMessage, textRenderer } from './lifecycle-harness';

/**
 * A field the server renders is not unbound (ADR 0022). A fragment boundary
 * lists the fields it depends on; when a fragment strategy renders it, an
 * edit of those fields is the boundary's to show. The unbound-change check
 * used to call such a field unbound anyway: it refreshed the whole route
 * first and rendered the boundary after, and `inspect().fidelity.fields`
 * named a field the page did show. The same held for a path inside a group a
 * boundary depends on under `subfieldCoverage: 'declared'`, and for a route
 * marker's fields, which the route strategy refreshes by itself.
 */

type Mode = 'descendant' | 'declared';

interface Harness {
  readonly runtime: LivePreviewRuntime;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly requests: StrategyRequest[];
}

function start(
  html: string,
  strategies: 'fragment+route' | 'route',
  mode: Mode = 'descendant',
  scopeBindingsByOwner = false,
  plan: RouteStrategy['plan'] = () => false,
): Harness {
  document.body.innerHTML = html;
  const requests: StrategyRequest[] = [];
  const fragment = fragmentStrategyFrom((request) => {
    requests.push(request);
    return Promise.resolve({ status: 'rendered', html: '<p>rendered</p>' });
  });
  const refresh = vi.fn<RouteStrategy['refresh']>().mockResolvedValue('refreshed');
  const route: RouteStrategy = { plan, refresh };
  const handlers: StrategyHandlers = strategies === 'route' ? { route } : { fragment, route };
  const runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    warn: () => {},
    strategies: handlers,
    subfieldCoverage: mode,
    scopeBindingsByOwner,
  });
  runtime.start();
  return { runtime, refresh, requests };
}

async function send(fields: Record<string, unknown>, globalSlug?: string): Promise<void> {
  fireMessage({
    type: 'payload-live-preview',
    data: fields,
    ...(globalSlug === undefined ? {} : { globalSlug }),
  });
  await vi.advanceTimersByTimeAsync(50);
}

afterEach(() => {
  document.head.innerHTML = '';
});

const BOUNDARY =
  '<h1 data-payload-field="title">T</h1>' +
  '<section data-payload-fragment="pricing" data-payload-depends="pricing, hero"><p>old</p></section>' +
  '<p data-payload-field="hero.eyebrow">E</p>';

describe('a field a fragment boundary depends on', () => {
  it('is rendered by the boundary, without a route refresh or an unbound report', async () => {
    const { runtime, refresh, requests } = start(BOUNDARY, 'fragment+route');
    await send({ title: 'T', pricing: 1 });
    const before = requests.length;
    await send({ title: 'T', pricing: 2 });
    expect(requests.length - before).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(runtime.inspect().fidelity.fields).not.toContain('pricing');
    runtime.destroy();
  });

  it("covers the paths inside a group it depends on under subfieldCoverage: 'declared'", async () => {
    const { runtime, refresh } = start(BOUNDARY, 'fragment+route', 'declared');
    await send({ title: 'T', hero: { eyebrow: 'E', note: 'N' } });
    await send({ title: 'T', hero: { eyebrow: 'E', note: 'N2' } });
    expect(refresh).not.toHaveBeenCalled();
    expect(runtime.inspect().fidelity.fields).not.toContain('hero.note');
    runtime.destroy();
  });

  it('covers nothing when no fragment strategy renders the boundary', async () => {
    const { runtime, refresh } = start(BOUNDARY, 'route');
    await send({ title: 'T', pricing: 1 });
    await send({ title: 'T', pricing: 2 });
    expect(refresh).toHaveBeenCalledOnce();
    expect(runtime.inspect().fidelity.fields).toContain('pricing');
    runtime.destroy();
  });

  it('counts a boundary that also carries a field binding', async () => {
    const { runtime, refresh } = start(
      '<h1 data-payload-field="title">T</h1>' +
        '<section data-payload-fragment="pricing" data-payload-field="summary" data-payload-depends="pricing"></section>',
      'fragment+route',
    );
    await send({ title: 'T', summary: 'S', pricing: 1 });
    await send({ title: 'T', summary: 'S', pricing: 2 });
    expect(refresh).not.toHaveBeenCalled();
    expect(runtime.inspect().fidelity.fields).not.toContain('pricing');
    runtime.destroy();
  });

  // The fragment planner skips both: an empty name is no boundary, and an
  // island renders its own content.
  (
    [
      [
        'an empty fragment name',
        '<section data-payload-fragment="" data-payload-depends="pricing"></section>',
      ],
      [
        'a boundary inside an island',
        '<div data-payload-island="x"><section data-payload-fragment="pricing" data-payload-depends="pricing"></section></div>',
      ],
      ['a depends list without a strategy', '<aside data-payload-depends="pricing"></aside>'],
    ] as const
  ).forEach(([name, markup]) => {
    it(`covers nothing for ${name}`, async () => {
      const { runtime, refresh } = start(
        `<h1 data-payload-field="title">T</h1>${markup}`,
        'fragment+route',
      );
      await send({ title: 'T', pricing: 1 });
      await send({ title: 'T', pricing: 2 });
      expect(refresh).toHaveBeenCalledOnce();
      expect(runtime.inspect().fidelity.fields).toContain('pricing');
      runtime.destroy();
    });
  });

  it("covers nothing for another document's update under owner scoping", async () => {
    const { runtime, refresh } = start(
      '<section data-payload-owner="global:home"><h1 data-payload-field="title">T</h1></section>' +
        '<section data-payload-owner="global:other"><div data-payload-fragment="pricing" data-payload-depends="pricing"></div></section>',
      'fragment+route',
      'descendant',
      true,
    );
    await send({ title: 'T', pricing: 1 }, 'home');
    await send({ title: 'T', pricing: 2 }, 'home');
    expect(refresh).toHaveBeenCalledOnce();
    runtime.destroy();
  });
});

describe('a field a route marker depends on', () => {
  it('is refreshed once by the route strategy and not reported as unbound', async () => {
    const { runtime, refresh } = start(
      '<h1 data-payload-field="title">T</h1><aside data-payload-strategy="route" data-payload-depends="banner"></aside>',
      'route',
      'descendant',
      false,
      (_root, changed) => changed.has('banner'),
    );
    // The first message may already carry unsaved values; the planner refreshes for it too.
    await send({ title: 'T', banner: 'a' });
    const first = refresh.mock.calls.length;
    await send({ title: 'T', banner: 'b' });
    expect(refresh.mock.calls.length - first).toBe(1);
    expect(runtime.inspect().fidelity.fields).not.toContain('banner');
    runtime.destroy();
  });

  // The route planner refreshes for a binding's own field and what it depends
  // on when the binding is route-bound: explicitly, or by sitting in <head>.
  (
    [
      [
        'a route-bound binding',
        '<h1 data-payload-field="title" data-payload-strategy="route" data-payload-depends="banner">T</h1>',
        '',
      ],
      [
        'a binding in <head>',
        '<h1 data-payload-field="title">T</h1>',
        '<meta name="description" data-payload-field="title" data-payload-depends="banner">',
      ],
    ] as const
  ).forEach(([name, body, head]) => {
    it(`counts ${name}`, async () => {
      document.head.innerHTML = head;
      const { runtime } = start(body, 'route', 'descendant', false, (_root, changed) =>
        changed.has('banner'),
      );
      await send({ title: 'T', banner: 'a' });
      await send({ title: 'T', banner: 'b' });
      expect(runtime.inspect().fidelity.fields).not.toContain('banner');
      runtime.destroy();
    });
  });

  // A binding outside <head> patches in place, marked so or not; what it
  // depends on is not shown by it.
  (
    [
      ['marked patch', ' data-payload-strategy="patch"'],
      ['unmarked in the body', ''],
    ] as const
  ).forEach(([name, strategy]) => {
    it(`covers nothing for a binding ${name}`, async () => {
      const { runtime } = start(
        `<h1 data-payload-field="title"${strategy} data-payload-depends="banner">T</h1>`,
        'route',
      );
      await send({ title: 'T', banner: 'a' });
      await send({ title: 'T', banner: 'b' });
      expect(runtime.inspect().fidelity.fields).toContain('banner');
      runtime.destroy();
    });
  });
});
