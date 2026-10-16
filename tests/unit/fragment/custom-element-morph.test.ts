/**
 * A custom element that carries `data-payload-morph` on the page and in the
 * markup the server renders is edited in place by the fragment and the route
 * strategy, as it is by the structural one (ADR 0008 §10). With the attribute
 * on one side only the host is replaced, as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { createFragmentStrategy, createRouteStrategy } from '@fragment/index';
import type { FragmentRequestBody } from '@/types/fragment-protocol';
import type { RouteContext } from '@core/strategies';

const ORIGIN = 'https://admin.example.com';
class IO implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
class Widget extends HTMLElement {
  connections = 0;
  connectedCallback(): void {
    this.connections += 1;
  }
}
customElements.define('x-fragment-widget', Widget);

const LIVE =
  '<x-fragment-widget data-payload-morph title="saved"><b>saved</b><p data-payload-owned>kept</p></x-fragment-widget>';
let runtime: LivePreviewRuntime | undefined;
let served = '';

function start(): LivePreviewRuntime {
  document.body.innerHTML =
    '<main data-payload-owner="collection:articles:7">' +
    '<section data-payload-fragment="catalog" data-payload-fragment-key="one" data-payload-depends="title">' +
    LIVE +
    '</section></main>';
  runtime = new LivePreviewRuntime({
    root: document.querySelector('main')!,
    renderers: {
      text: {
        name: 'text',
        render: (target, value) => {
          target.element.textContent = String(value);
        },
      },
    },
    emitter: new EventEmitter(),
    debounceMs: 0,
    enableA11y: false,
    autoBind: 'off',
    disableVisibilityGate: true,
    scopeBindingsByOwner: true,
    heartbeatMs: 600_000,
    originMatcher: (value) => value === ORIGIN,
    readyTargets: [ORIGIN],
    warn: () => {},
    strategies: {
      fragment: createFragmentStrategy({
        endpoint: '/payload/fragment',
        fetch: (_url, init) => {
          if (typeof init?.body !== 'string') throw new Error('Expected JSON request');
          const body = JSON.parse(init.body) as FragmentRequestBody;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                html: served,
                boundary: { id: body.fragment, key: body.key },
                revision: body.revision,
                metadata: { renderedAt: '2026-10-10T00:00:00.000Z', renderer: 'test' },
              }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        },
      }),
    },
  });
  runtime.start();
  return runtime;
}
function post(title: string): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: ORIGIN,
      data: {
        type: 'payload-live-preview',
        collectionSlug: 'articles',
        locale: 'de',
        data: { id: 7, title },
      },
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IO);
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  vi.unstubAllGlobals();
});

describe('the fragment strategy and a custom element', () => {
  it('edits a host that both sides mark, and keeps its identity and its owned child', async () => {
    served =
      '<x-fragment-widget data-payload-morph title="server"><b>server</b><p data-payload-owned>new</p></x-fragment-widget>';
    start();
    const host = document.querySelector<Widget>('x-fragment-widget')!;
    post('unsaved');
    await expect.poll(() => host.getAttribute('title')).toBe('server');
    expect(document.querySelector('x-fragment-widget')).toBe(host);
    expect(host.querySelector('b')?.textContent).toBe('server');
    expect(host.querySelector('p')?.textContent).toBe('kept');
    expect(host.connections).toBe(1);
  });

  it('replaces a host that only the page marks, as it did before the attribute existed', async () => {
    served = '<x-fragment-widget title="server"><b>server</b></x-fragment-widget>';
    start();
    const host = document.querySelector<Widget>('x-fragment-widget')!;
    post('unsaved');
    await expect
      .poll(() => document.querySelector('x-fragment-widget')?.getAttribute('title'))
      .toBe('server');
    expect(document.querySelector('x-fragment-widget')).not.toBe(host);
    expect(document.querySelector('x-fragment-widget')?.hasAttribute('data-payload-morph')).toBe(
      false,
    );
  });
});

describe('the route strategy and a custom element', () => {
  function context(): RouteContext {
    return {
      revision: 1,
      receivedAt: 1,
      signal: new AbortController().signal,
      isCurrent: () => true,
      log: () => {},
    };
  }
  async function refresh(body: string): Promise<void> {
    const strategy = createRouteStrategy({
      fetch: () =>
        Promise.resolve(
          new Response(`<!doctype html><html><head></head><body>${body}</body></html>`, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
        ),
      location: { href: 'https://site.example.com/page' },
      window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
    });
    expect(await strategy.refresh(context())).toBe('partial');
  }

  it('edits a host that both sides mark and replaces one that only the page marks', async () => {
    document.body.innerHTML = LIVE;
    const host = document.querySelector<Widget>('x-fragment-widget')!;
    await refresh(
      '<x-fragment-widget data-payload-morph="" title="route"><b>route</b><p data-payload-owned>new</p></x-fragment-widget>',
    );
    expect(document.querySelector('x-fragment-widget')).toBe(host);
    expect(host.getAttribute('title')).toBe('route');
    expect(host.querySelector('b')?.textContent).toBe('route');
    expect(host.querySelector('p')?.textContent).toBe('kept');
    expect(host.connections).toBe(1);

    await refresh('<x-fragment-widget title="again"><b>again</b></x-fragment-widget>');
    expect(document.querySelector('x-fragment-widget')).not.toBe(host);
    expect(document.querySelector('x-fragment-widget')?.getAttribute('title')).toBe('again');
  });
});
