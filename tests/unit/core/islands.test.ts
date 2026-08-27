import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { ISLAND_EVENT, isInsideIsland, type IslandUpdateDetail } from '@core/islands';
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
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}
function start(): void {
  runtime = new LivePreviewRuntime({
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
});
