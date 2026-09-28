/**
 * The fragment strategy hands server-rendered island props to Astro instead
 * of keeping an island at its first revision (ADR 0021). The real runtime and
 * fragment strategy run; the handler and the island element are stand-ins with
 * the semantics read from Astro 7.3.2 and @astrojs/react 6.0.6.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { fragmentStrategyFrom, type FragmentHandler } from '@fragment/index';

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
const titles: unknown[] = [];
const unmounted: Element[] = [];
const warnings: string[] = [];
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;

class StandInIsland extends HTMLElement {
  static observedAttributes = ['props'];
  started = false;

  start(): void {
    this.started = true;
    this.addEventListener('astro:unmount', () => unmounted.push(this), { once: true });
    this.hydrate();
  }

  hydrate(): void {
    if (!this.started || !this.isConnected) return;
    if (this.hasAttribute('ssr')) {
      titles.push((JSON.parse(this.getAttribute('props') ?? '{}') as { title?: unknown }).title);
    }
    this.removeAttribute('ssr');
  }

  attributeChangedCallback(): void {
    this.hydrate();
  }
}

const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

function card(title: string, client = 'load'): string {
  return (
    `<h2 data-payload-field="title">${title}</h2>` +
    `<astro-island component-url="/_astro/Panel.js" component-export="default" ` +
    `renderer-url="/_astro/client.js" client="${client}" opts='{"name":"Panel","value":true}' ` +
    `ssr props='{"title":"${title}"}'><h3>${title}</h3></astro-island>`
  );
}

function start(render: (title: string) => string): void {
  const fragment: FragmentHandler = (request) =>
    Promise.resolve({ status: 'rendered', html: render(String(request.fields['title'])) });
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: (message) => {
      warnings.push(String(message));
    },
    strategies: { fragment: fragmentStrategyFrom(fragment) },
  });
  runtime.start();
}

async function revise(title: string): Promise<void> {
  const rendered = new Promise((resolve) => {
    emitter.once('fragmentRender', resolve);
  });
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data: { title }, globalSlug: 'home' },
      origin: TRUSTED,
    }),
  );
  await rendered;
}

function liveIsland(): StandInIsland {
  const island = document.querySelector('astro-island');
  if (!(island instanceof StandInIsland)) throw new Error('island not upgraded');
  return island;
}

beforeAll(() => {
  customElements.define('astro-island', StandInIsland);
});

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  titles.length = 0;
  unmounted.length = 0;
  warnings.length = 0;
  Reflect.set(window, 'Astro', { load: () => undefined });
  document.body.innerHTML = `<section data-payload-fragment="card">${card('Saved')}</section>`;
  liveIsland().start();
});

afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  Reflect.deleteProperty(window, 'Astro');
});

describe('fragment islands (ADR 0021)', () => {
  it('hands each unsaved revision to the same hydrated island', async () => {
    start((title) => card(title));
    const island = liveIsland();

    await revise('First unsaved');
    await revise('Second unsaved');

    expect(liveIsland()).toBe(island);
    expect(titles).toEqual(['Saved', 'First unsaved', 'Second unsaved']);
    expect(document.querySelector('h2')?.textContent).toBe('Second unsaved');
    expect(unmounted).toEqual([]);
    expect(warnings.filter((message) => message.includes('LP0809'))).toEqual([]);
  });

  it('releases an island a revision removes from the fragment', async () => {
    start((title) => `<h2 data-payload-field="title">${title}</h2>`);
    const island = liveIsland();

    await revise('Without island');

    expect(island.isConnected).toBe(false);
    expect(unmounted).toEqual([island]);
  });

  it('does not invent a directive name for an inserted island that carries none', async () => {
    start((title) => card(title).replace(' client="load"', ''));

    await revise('No directive');

    expect(warnings.filter((message) => message.includes('LP0809'))).toEqual([
      '[live-preview] LP0809: a fragment island cannot start: this page never loaded client:; render one on the page',
    ]);
  });

  it('reports once per session even when every revision inserts another island', async () => {
    // Each title renders its own component, so each revision replaces the
    // island and inserts one the page cannot start.
    start((title) =>
      card(title, 'visible').replace('/_astro/Panel.js', `/_astro/${title.replace(/\s/gu, '')}.js`),
    );

    await revise('First');
    const firstInserted = liveIsland();
    await revise('Second');

    expect(liveIsland()).not.toBe(firstInserted);
    const reports = warnings.filter((message) => message.includes('LP0809'));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toContain('client:visible');
  });
});
