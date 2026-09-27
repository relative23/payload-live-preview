import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import {
  dispatchIslandUpdate,
  ISLAND_EVENT,
  isInsideIsland,
  type IslandUpdateDetail,
} from '@core/islands';
import type { FieldRenderer } from '@core/types';

/**
 * Island interoperability (roadmap 1.3.0): a binding inside a hydrated
 * island is not patched, the island receives the update as a DOM event
 * instead, and an island that opts in gets patched like any other subtree.
 */

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

function post(data: Record<string, unknown>, extra: Record<string, unknown> = {}): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data, ...extra },
      origin: TRUSTED,
    }),
  );
}
/** Poll for `condition`; an island-only flush emits no `afterUpdate` to await. */
async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}
function start(extra: { scopeBindingsByOwner?: boolean; skipUnchanged?: boolean } = {}): void {
  runtime = new LivePreviewRuntime({
    ...extra,
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
  });
  runtime.start();
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('isInsideIsland', () => {
  it('recognises astro-island and data-payload-island ancestors, and the patch opt-in', () => {
    document.body.innerHTML =
      '<astro-island><p id="a"></p></astro-island><div data-payload-island><p id="b"></p></div><div data-payload-island="patch"><p id="c"></p></div><p id="d"></p>';
    const by = (id: string) => document.getElementById(id) as Element;
    expect(isInsideIsland(by('a'))).toBe(true);
    expect(isInsideIsland(by('b'))).toBe(true);
    expect(isInsideIsland(by('c'))).toBe(false);
    expect(isInsideIsland(by('d'))).toBe(false);
  });

  it('does not begin an island fanout after its revision became stale', () => {
    const island = document.createElement('astro-island');
    let events = 0;
    island.addEventListener(ISLAND_EVENT, () => {
      events += 1;
    });

    expect(
      dispatchIslandUpdate(
        [island],
        { fields: { title: 'stale' }, revision: 1, receivedAt: 1, locale: undefined },
        () => false,
      ),
    ).toBe(0);
    expect(events).toBe(0);
  });
});

describe('runtime and islands', () => {
  it('patches outside islands, leaves island bindings alone, and hands islands the update as an event', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old</p>' +
      '<astro-island><p data-payload-field="title">island</p></astro-island>' +
      '<section data-payload-island><span data-payload-field="title">marked</span></section>';
    start();
    const received: IslandUpdateDetail[] = [];
    for (const island of document.querySelectorAll('astro-island, [data-payload-island]')) {
      island.addEventListener(ISLAND_EVENT, (event) => {
        received.push((event as CustomEvent<IslandUpdateDetail>).detail);
      });
    }
    const done = afterUpdate();
    post({ title: 'new' }, { locale: 'de' });
    await done;
    expect(document.querySelector('body > p')?.textContent).toBe('new');
    expect(document.querySelector('astro-island p')?.textContent).toBe('island');
    expect(document.querySelector('section span')?.textContent).toBe('marked');
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ fields: { title: 'new' }, locale: 'de' });
    expect(received[0]?.revision).toBeTypeOf('number');
    expect(received[0]?.receivedAt).toBeTypeOf('number');
    expect(runtime?.inspect().bindings.elements).toBe(1);
  });

  it('hands an island the update even when nothing outside it was written', async () => {
    // A page whose only bindings sit inside islands has no patch to apply; the
    // event is how the island learns of the edit at all.
    document.body.innerHTML =
      '<astro-island><p data-payload-field="title">island</p></astro-island>';
    start();
    const received: IslandUpdateDetail[] = [];
    document.querySelector('astro-island')?.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    post({ title: 'new' });
    await waitFor(() => received.length === 1);
    expect(received[0]).toMatchObject({ fields: { title: 'new' } });
    expect(document.querySelector('astro-island p')?.textContent).toBe('island');
  });

  it('sends an owned document only to its own islands when owner scoping is on', async () => {
    document.body.innerHTML =
      '<astro-island id="own" data-payload-owner="global:home"></astro-island>' +
      '<astro-island id="foreign" data-payload-owner="global:other"></astro-island>' +
      '<astro-island id="unowned"></astro-island>';
    start({ scopeBindingsByOwner: true });
    const received = new Map<string, IslandUpdateDetail[]>();
    for (const island of document.querySelectorAll('astro-island')) {
      const events: IslandUpdateDetail[] = [];
      received.set(island.id, events);
      island.addEventListener(ISLAND_EVENT, (event) => {
        events.push((event as CustomEvent<IslandUpdateDetail>).detail);
      });
    }

    post({ title: 'home draft' }, { globalSlug: 'home' });
    await waitFor(() => received.get('own')?.length === 1);

    expect(received.get('own')).toHaveLength(1);
    expect(received.get('foreign')).toHaveLength(0);
    expect(received.get('unowned')).toHaveLength(0);
  });

  it('keeps island fanout global when owner scoping is off', async () => {
    document.body.innerHTML =
      '<astro-island id="own" data-payload-owner="global:home"></astro-island>' +
      '<astro-island id="foreign" data-payload-owner="global:other"></astro-island>' +
      '<astro-island id="unowned"></astro-island>';
    start();
    const received: string[] = [];
    for (const island of document.querySelectorAll('astro-island')) {
      island.addEventListener(ISLAND_EVENT, () => {
        received.push(island.id);
      });
    }

    post({ title: 'home draft' }, { globalSlug: 'home' });
    await waitFor(() => received.length === 3);

    expect(received).toEqual(['own', 'foreign', 'unowned']);
  });

  it('owner-filters islands that stream in while Astro hydration is pending', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:home"><p data-payload-field="title">saved</p></section>';
    start({ scopeBindingsByOwner: true });
    const first = afterUpdate();
    post({ title: 'home draft' }, { globalSlug: 'home' });
    await first;
    runtime?.navigationCommit();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    const received = new Map<string, IslandUpdateDetail[]>();
    for (const [id, owner] of [
      ['own', 'global:home'],
      ['foreign', 'global:other'],
      ['unowned', undefined],
    ] as const) {
      const island = document.createElement('astro-island');
      island.id = id;
      island.setAttribute('ssr', '');
      if (owner !== undefined) island.setAttribute('data-payload-owner', owner);
      const events: IslandUpdateDetail[] = [];
      received.set(id, events);
      island.addEventListener(ISLAND_EVENT, (event) => {
        events.push((event as CustomEvent<IslandUpdateDetail>).detail);
      });
      document.body.append(island);
    }
    await waitFor(() => runtime?.cache.islands.length === 3);
    for (const island of document.querySelectorAll('astro-island')) {
      island.removeAttribute('ssr');
    }
    await waitFor(() => received.get('own')?.length === 1);

    expect(received.get('own')?.[0]).toMatchObject({ fields: { title: 'home draft' } });
    expect(received.get('foreign')).toHaveLength(0);
    expect(received.get('unowned')).toHaveLength(0);
  });

  it('replays the retained document when an island retargets to the current owner', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:home"><p data-payload-field="title">saved</p></section>' +
      '<astro-island data-payload-owner="global:other"></astro-island>';
    let cacheRefreshes = 0;
    emitter.on('cacheRefresh', () => {
      cacheRefreshes += 1;
    });
    start({ scopeBindingsByOwner: true });
    const island = document.querySelector('astro-island');
    if (island === null) throw new Error('island missing');
    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    const first = afterUpdate();
    post({ title: 'home draft' }, { globalSlug: 'home' });
    await first;
    runtime?.navigationCommit();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(received).toHaveLength(0);

    const refreshesBeforeRetarget = cacheRefreshes;
    island.setAttribute('data-payload-owner', 'global:home');
    await waitFor(() => cacheRefreshes > refreshesBeforeRetarget);
    await waitFor(() => received.length === 1);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ fields: { title: 'home draft' } });
  });

  it('does not replay an owner retarget when owner scoping is off', async () => {
    document.body.innerHTML = '<astro-island data-payload-owner="global:other"></astro-island>';
    let cacheRefreshes = 0;
    emitter.on('cacheRefresh', () => {
      cacheRefreshes += 1;
    });
    start();
    const island = document.querySelector('astro-island');
    if (island === null) throw new Error('island missing');
    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    post({ title: 'home draft' }, { globalSlug: 'home' });
    await waitFor(() => received.length === 1);
    runtime?.navigationCommit();
    await waitFor(() => received.length === 2);

    const refreshesBeforeRetarget = cacheRefreshes;
    island.setAttribute('data-payload-owner', 'global:home');
    await waitFor(() => cacheRefreshes > refreshesBeforeRetarget);
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });

    expect(received).toHaveLength(2);
  });

  it('stops a stale island fanout when its first listener accepts a newer document', async () => {
    document.body.innerHTML =
      '<astro-island id="first"></astro-island><astro-island id="second"></astro-island>';
    start();
    const secondReceived: string[] = [];
    document.getElementById('first')?.addEventListener(ISLAND_EVENT, (event) => {
      const detail = (event as CustomEvent<IslandUpdateDetail>).detail;
      if (detail.fields['title'] === 'older') post({ title: 'newer' });
    });
    document.getElementById('second')?.addEventListener(ISLAND_EVENT, (event) => {
      const detail = (event as CustomEvent<IslandUpdateDetail>).detail;
      secondReceived.push(String(detail.fields['title']));
    });

    post({ title: 'older' });
    await waitFor(() => secondReceived.includes('newer'));

    expect(secondReceived).toEqual(['newer']);
  });

  it('hands an update received during initial Astro hydration to the hydrated island', async () => {
    document.body.innerHTML =
      '<astro-island ssr><p data-payload-field="title">server</p></astro-island>';
    start();
    post({ title: 'unsaved while hydrating' });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    const island = document.querySelector('astro-island');
    if (island === null) throw new Error('island missing');
    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    island.removeAttribute('ssr');
    island.dispatchEvent(new CustomEvent('astro:hydrate'));
    await waitFor(() => received.length > 0);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ fields: { title: 'unsaved while hydrating' } });
  });

  it('with skipUnchanged, a field only an island shows still reaches it', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">same</p>' +
      '<astro-island><span data-payload-field="teaser">old</span></astro-island>';
    start({ skipUnchanged: true });
    const received: IslandUpdateDetail[] = [];
    document.querySelector('astro-island')?.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    const first = afterUpdate();
    post({ title: 'same', teaser: 'old' });
    await first;
    expect(received).toHaveLength(1);
    // Only the island's field changes: nothing outside is written, and the
    // island must still hear about it.
    post({ title: 'same', teaser: 'new' });
    await waitFor(() => received.length === 2);
    expect(received[1]).toMatchObject({ fields: { teaser: 'new' } });
  });

  it('sends an island nothing for a message that changed no field', async () => {
    document.body.innerHTML =
      '<astro-island><p data-payload-field="title">island</p></astro-island>';
    start();
    const received: IslandUpdateDetail[] = [];
    document.querySelector('astro-island')?.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });
    post({ title: 'new' });
    await waitFor(() => received.length === 1);
    // The same document again: nothing changed, so nothing to re-render.
    post({ title: 'new' });
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
    expect(received).toHaveLength(1);
  });

  it('patches inside an island that opted in with data-payload-island="patch" and sends it no event', async () => {
    document.body.innerHTML =
      '<div data-payload-island="patch"><p data-payload-field="title">old</p></div>';
    start();
    let events = 0;
    document.querySelector('[data-payload-island]')?.addEventListener(ISLAND_EVENT, () => {
      events += 1;
    });
    const done = afterUpdate();
    post({ title: 'new' });
    await done;
    expect(document.querySelector('p')?.textContent).toBe('new');
    expect(events).toBe(0);
  });

  it('rebuilds ownership when data-payload-island toggles between boundary and patch', async () => {
    document.body.innerHTML = '<div id="dynamic"><p data-payload-field="title">published</p></div>';
    start();
    const island = document.getElementById('dynamic');
    const binding = island?.querySelector('p');
    if (island === null || binding === null || binding === undefined) {
      throw new Error('fixture missing');
    }
    const received: IslandUpdateDetail[] = [];
    island.addEventListener(ISLAND_EVENT, (event) => {
      received.push((event as CustomEvent<IslandUpdateDetail>).detail);
    });

    island.setAttribute('data-payload-island', '');
    await waitFor(() => runtime?.cache.islands.includes(island) === true);
    post({ title: 'owned' });
    await waitFor(() => received.length === 1);

    expect(binding.textContent).toBe('published');
    expect(received[0]).toMatchObject({ fields: { title: 'owned' } });

    island.setAttribute('data-payload-island', 'patch');
    await waitFor(() => runtime?.cache.has(binding) === true);
    const done = afterUpdate();
    post({ title: 'patched' });
    await done;

    expect(binding.textContent).toBe('patched');
    expect(received).toHaveLength(1);
  });
});
