import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { fragmentStrategyFrom, type FragmentHandler, type StrategyRequest } from '@fragment/index';

/**
 * The fragment strategy in the core (roadmap 1.6.0): a `data-payload-fragment`
 * boundary is rendered by the configured handler once per revision that
 * touches it, morphed in with focus preserved, superseded by a newer
 * revision (the request is aborted), and patched from the same data when
 * the handler fails. Without a handler the boundary is patched, once
 * warned. The handler is a fake here; the HTTP client has its own suite.
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
const warnings: string[] = [];
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};
function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data, globalSlug: 'home' },
      origin: TRUSTED,
    }),
  );
}
function once(name: 'afterUpdate' | 'fragmentRender' | 'error'): Promise<unknown> {
  return new Promise((resolve) => {
    emitter.once(name, (event) => {
      resolve(event);
    });
  });
}
function start(
  fragment?: FragmentHandler,
  options: { dependencies?: Readonly<Record<string, readonly string[]>> } = {},
): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    ...options,
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
    ...(fragment === undefined ? {} : { strategies: { fragment: fragmentStrategyFrom(fragment) } }),
  });
  runtime.start();
  return runtime;
}
const PAGE =
  '<section data-payload-fragment="hero" data-payload-depends="title,tagline">' +
  '<h1 data-payload-field="title">Old title</h1><input id="i">' +
  '</section>' +
  '<p data-payload-field="footer">Old footer</p>';

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  warnings.length = 0;
  document.body.innerHTML = PAGE;
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('fragment strategy', () => {
  it('renders a touched boundary through the handler and morphs it in, keeping focus', async () => {
    const requests: StrategyRequest[] = [];
    const rt = start((request, boundary) => {
      requests.push(request);
      return Promise.resolve({
        status: 'rendered',
        html: `<h1 data-payload-field="title">Server: ${String(request.fields['title'])}</h1><input id="i"><p>from ${boundary.id}</p>`,
      });
    });
    const input = document.getElementById('i') as HTMLInputElement;
    input.focus();
    input.value = 'typed';
    const done = once('afterUpdate');
    post({ title: 'New', footer: 'Foot' });
    const event = (await done) as { source: string; updatedCount: number };
    expect(event.source).toBe('fragment');
    expect(event.updatedCount).toBe(1);
    expect(document.querySelector('h1')?.textContent).toBe('Server: New');
    expect(document.querySelector('section p')?.textContent).toBe('from hero');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('typed');
    expect(requests[0]).toMatchObject({ globalSlug: 'home', fields: { title: 'New' } });
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(rt.inspect().fragments).toMatchObject({ handler: true, rendered: 1, failed: 0 });
  });

  it('patches the footer outside the boundary and leaves the boundary to the server', async () => {
    const handler = vi.fn(() =>
      Promise.resolve({
        status: 'rendered' as const,
        html: '<h1 data-payload-field="title">S</h1>',
      }),
    );
    start(handler);
    // Two afterUpdate events for one revision: the patch flush and the fragment.
    const both = new Promise<void>((resolve) => {
      const seen = new Set<string>();
      emitter.on('afterUpdate', (event) => {
        seen.add(String(event.source));
        if (seen.has('patch') && seen.has('fragment')) resolve();
      });
    });
    post({ title: 'New', footer: 'Foot' });
    await both;
    expect(document.querySelector('p[data-payload-field="footer"]')?.textContent).toBe('Foot');
    expect(document.querySelector('h1')?.textContent).toBe('S');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not render a boundary whose dependencies the update does not touch', async () => {
    const handler = vi.fn(() => Promise.resolve({ status: 'rendered' as const, html: '' }));
    start(handler);
    const done = once('afterUpdate');
    post({ footer: 'Only footer' });
    await done;
    expect(handler).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('Old title');
  });

  it('falls back to patching the boundary bindings when the handler fails, with LP0801', async () => {
    const rt = start(() => Promise.reject(new Error('endpoint down')));
    const error = once('error');
    const done = once('afterUpdate');
    post({ title: 'Patched', footer: 'Foot' });
    expect((await error) as object).toMatchObject({ code: 'LP0801', context: 'fragment' });
    await done;
    expect(document.querySelector('h1')?.textContent).toBe('Patched');
    expect(rt.inspect().fragments).toMatchObject({ rendered: 0, failed: 1 });
  });

  it('aborts an in-flight render when a newer revision arrives and applies only the newest', async () => {
    const signals: AbortSignal[] = [];
    let release: (() => void) | undefined;
    const rt = start((request) => {
      signals.push(request.signal);
      if (request.fields['title'] === 'first') {
        return new Promise((resolve) => {
          release = () => {
            resolve({ status: 'rendered', html: '<h1 data-payload-field="title">first</h1>' });
          };
        });
      }
      return Promise.resolve({
        status: 'rendered',
        html: `<h1 data-payload-field="title">${String(request.fields['title'])}</h1>`,
      });
    });
    post({ title: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const done = once('afterUpdate');
    post({ title: 'second' });
    await done;
    expect(signals[0]?.aborted).toBe(true);
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.querySelector('h1')?.textContent).toBe('second');
    expect(rt.inspect().fragments.superseded).toBe(1);
    expect(rt.inspect().revisions.superseded).toBe(1);
  });

  it('patches a fragment boundary when no handler is configured, warning LP0806 once', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><h1 data-payload-field="title" data-payload-strategy="fragment">Old</h1></section>';
    const rt = start();
    let done = once('afterUpdate');
    post({ title: 'One' });
    await done;
    done = once('afterUpdate');
    post({ title: 'Two' });
    await done;
    expect(document.querySelector('h1')?.textContent).toBe('Two');
    expect(warnings.filter((w) => w.includes('LP0806'))).toHaveLength(1);
    expect(rt.inspect().fragments.handler).toBe(false);
  });

  it('re-renders a boundary that depends on a derived field when a source in the dependency registry changes', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="price" data-payload-depends="priceLabel"><span>0</span></section>';
    const handler = vi.fn(() =>
      Promise.resolve({ status: 'rendered' as const, html: '<span>rendered</span>' }),
    );
    start(handler, { dependencies: { price: ['priceLabel'] } });
    const done = once('fragmentRender');
    post({ price: 12 });
    await done;
    expect(handler).toHaveBeenCalledTimes(1);
    expect(document.querySelector('section span')?.textContent).toBe('rendered');
  });

  it('never renders a boundary inside an island', async () => {
    document.body.innerHTML =
      '<astro-island><section data-payload-fragment="hero"><h1 data-payload-field="title">Old</h1></section></astro-island>';
    const handler = vi.fn(() =>
      Promise.resolve({ status: 'rendered' as const, html: '<h1>x</h1>' }),
    );
    start(handler);
    post({ title: 'New' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(handler).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('Old');
  });
});
