import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FragmentContext, FragmentStrategy } from '@core/strategies';
import type { FieldRenderer } from '@core/types';
import {
  fragmentStrategyFrom,
  type FragmentHandler,
  type FragmentOutcome,
  type StrategyRequest,
} from '@fragment/index';

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
const logs: string[] = [];
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
  options: {
    dependencies?: Readonly<Record<string, readonly string[]>>;
    scopeBindingsByOwner?: boolean;
  } = {},
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
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
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
  logs.length = 0;
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

  it('owner-filters bindings patched after an in-scope fragment fails', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero" data-payload-owner="global:home">' +
      '<h1 id="own" data-payload-field="title">Old own</h1>' +
      '<div data-payload-owner="global:other">' +
      '<h2 id="foreign" data-payload-field="title">Old foreign</h2></div>' +
      '<h3 id="unowned" data-payload-owner="" data-payload-field="title">Old unowned</h3>' +
      '</section>';
    start(() => Promise.reject(new Error('endpoint down')), { scopeBindingsByOwner: true });

    post({ title: 'Draft home' });
    await vi.waitFor(() => {
      expect(document.querySelector('#own')?.textContent).toBe('Draft home');
    });

    expect(document.querySelector('#foreign')?.textContent).toBe('Old foreign');
    expect(document.querySelector('#unowned')?.textContent).toBe('Old unowned');
  });

  it('patches every nested owner on fragment failure when owner scoping is off', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero" data-payload-owner="global:home">' +
      '<h1 id="own" data-payload-field="title">Old own</h1>' +
      '<div data-payload-owner="global:other">' +
      '<h2 id="foreign" data-payload-field="title">Old foreign</h2></div>' +
      '<h3 id="unowned" data-payload-owner="" data-payload-field="title">Old unowned</h3>' +
      '</section>';
    start(() => Promise.reject(new Error('endpoint down')));

    post({ title: 'Draft' });
    await vi.waitFor(() => {
      expect(document.querySelector('#own')?.textContent).toBe('Draft');
    });

    expect(document.querySelector('#foreign')?.textContent).toBe('Draft');
    expect(document.querySelector('#unowned')?.textContent).toBe('Draft');
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

  it('does not run stale fragment plans after synchronous reentrant work', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero"></section>' +
      '<p data-payload-field="footer">old footer</p>';
    const rendered: string[] = [];
    let reenterPlan = true;
    let reenterDiagnostic = false;
    const fragment: FragmentStrategy = {
      plan: (root) => {
        if (reenterPlan) {
          reenterPlan = false;
          post({ title: 'newer' });
        }
        return [...root.querySelectorAll('[data-payload-fragment]')];
      },
      render: (context, boundaries) => {
        rendered.push(String(context.fields['title']));
        return Promise.resolve({ rendered: boundaries.length, failed: 0, superseded: 0 });
      },
    };
    runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
      onUnfaithfulPatch: 'ignore',
      warn: () => {
        if (!reenterDiagnostic) return;
        reenterDiagnostic = false;
        post({ title: 'diagnostic-newer', footer: 'newer footer' });
      },
      strategies: { fragment },
    });
    runtime.start();

    post({ title: 'older' });
    await vi.waitFor(() => {
      expect(rendered).toEqual(['newer']);
    });

    reenterDiagnostic = true;
    post({ title: 'diagnostic-old', footer: 'old footer', orphan: 'diagnose me' });
    await vi.waitFor(() => {
      expect(rendered).toEqual(['newer', 'diagnostic-newer']);
    });
  });

  it('does not render or transform stale fields through retained custom callbacks', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><h1 data-payload-field="title">Old</h1></section>';
    const contexts: FragmentContext[] = [];
    const settle: ((report: { rendered: number; failed: number; superseded: number }) => void)[] =
      [];
    const transformValue = vi.fn((_field: string, value: unknown) => value);
    const fragment: FragmentStrategy = {
      plan: (root) => [...root.querySelectorAll('[data-payload-fragment]')],
      render: (context) => {
        contexts.push(context);
        return new Promise((resolve) => {
          settle.push(resolve);
        });
      },
    };
    runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer },
      transformValue,
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
      strategies: { fragment },
    });
    runtime.start();

    post({ title: 'older' });
    await vi.waitFor(() => {
      expect(contexts).toHaveLength(1);
    });
    post({ title: 'newer' });
    await vi.waitFor(() => {
      expect(contexts).toHaveLength(2);
    });
    const boundary = document.querySelector('[data-payload-fragment]');
    if (boundary === null || contexts[0] === undefined) throw new Error('fixture missing');

    contexts[0].morph(boundary, '<h1 data-payload-field="title">Stale</h1>');
    contexts[0].patch(boundary);

    expect(contexts[0].isCurrent()).toBe(false);
    expect(boundary.textContent).toBe('Old');
    expect(transformValue).not.toHaveBeenCalled();
    for (const resolve of settle) resolve({ rendered: 0, failed: 0, superseded: 1 });
  });

  it('completes a revision only after every streamed fragment run settles', async () => {
    const pending = new Map<
      string,
      { resolve: (outcome: FragmentOutcome) => void; request: StrategyRequest }
    >();
    let hold = false;
    const rt = start((request, boundary) => {
      if (!hold) {
        return Promise.resolve({
          status: 'rendered',
          html: `<h1 data-payload-field="title">${String(request.fields['title'])}</h1>`,
        });
      }
      return new Promise((resolve) => {
        pending.set(boundary.id, { resolve, request });
      });
    });
    post({ title: 'baseline' });
    await once('fragmentRender');
    await vi.waitFor(() => {
      expect(rt.inspect().revisions.completed).toBe(1);
    });
    rt.navigationCommit();
    await once('fragmentRender');
    await vi.waitFor(() => {
      expect(rt.inspect().fragments.inFlight).toBe(0);
    });

    hold = true;
    post({ title: 'draft' });
    await vi.waitFor(() => {
      expect(pending.has('hero')).toBe(true);
    });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section data-payload-fragment="late" data-payload-depends="title"><h2>saved</h2></section>' +
        '<section data-payload-fragment="untouched" data-payload-depends="footer"><h2>saved footer</h2></section>',
    );
    await vi.waitFor(
      () => {
        expect(pending.has('late')).toBe(true);
      },
      { timeout: 500 },
    );
    expect(pending.has('untouched')).toBe(false);
    expect(rt.inspect().fragments.inFlight).toBe(2);

    pending.get('late')?.resolve({
      status: 'rendered',
      html: '<h2>draft</h2>',
    });
    await vi.waitFor(() => {
      expect(rt.inspect().fragments.inFlight).toBe(1);
    });
    expect(rt.inspect().revisions.completed).toBe(1);

    pending.get('hero')?.resolve({
      status: 'rendered',
      html: '<h1 data-payload-field="title">draft</h1>',
    });
    await vi.waitFor(() => {
      expect(rt.inspect().revisions.completed).toBe(2);
    });
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

  it('puts a failed boundary on the log sink as well as the error event', async () => {
    // Measured (test run C, finding C2): a fragment that timed out counted in
    // `inspect().fragments.failed` and fired the error event carrying LP0801,
    // and no line reached the runtime's log sink or `console.debug` under
    // `debug: true`. The supplied strategy answers a timeout with an outcome
    // instead of throwing, so the only LP0801 the runner logged sat in the
    // `catch` around `render()`, which that strategy never reaches.
    const rt = start(() =>
      Promise.resolve({ status: 'failed', code: 'LP0801', reason: 'timeout after 60 ms' }),
    );
    const error = once('error');
    // The tally is added when `render()` returns, which is after the event the
    // failure fires, so the revision has to finish before it can be read.
    const done = once('afterUpdate');
    post({ title: 'Patched', footer: 'Foot' });
    await error;
    await done;
    expect(logs.filter((line) => line.includes('LP0801'))).toEqual([
      'fragment LP0801 fragment "hero" fell back to patch: timeout after 60 ms',
    ]);
    expect(rt.inspect().fragments.failed).toBe(1);
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

  it('renders only a normally planned boundary owned by the current document', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:home"><div data-payload-fragment="own" data-payload-depends="title"></div></section>' +
      '<section data-payload-owner="global:other"><div data-payload-fragment="foreign" data-payload-depends="title"></div></section>' +
      '<div data-payload-fragment="unowned" data-payload-depends="title"></div>';
    const rendered: string[] = [];
    start(
      (_request, boundary) => {
        rendered.push(boundary.id);
        return Promise.resolve({ status: 'rendered', html: '<p>draft</p>' });
      },
      { scopeBindingsByOwner: true },
    );

    post({ title: 'draft' });
    await vi.waitFor(() => {
      expect(rendered).toEqual(['own']);
    });
  });

  it('keeps owner filtering off when scopeBindingsByOwner is off', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:home"><div data-payload-fragment="own" data-payload-depends="title"></div></section>' +
      '<section data-payload-owner="global:other"><div data-payload-fragment="foreign" data-payload-depends="title"></div></section>' +
      '<div data-payload-fragment="unowned" data-payload-depends="title"></div>';
    const rendered: string[] = [];
    start((_request, boundary) => {
      rendered.push(boundary.id);
      return Promise.resolve({ status: 'rendered', html: '<p>draft</p>' });
    });

    post({ title: 'draft' });
    await vi.waitFor(() => {
      expect(rendered).toEqual(['own', 'foreign', 'unowned']);
    });
  });

  it('owner-filters fieldless fragment boundaries streamed after navigation', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="global:home"><h1 data-payload-field="title">saved</h1></section>';
    const rendered: string[] = [];
    const rt = start(
      (_request, boundary) => {
        rendered.push(boundary.id);
        return Promise.resolve({ status: 'rendered', html: '<p>draft</p>' });
      },
      { scopeBindingsByOwner: true },
    );
    let done = once('afterUpdate');
    post({ title: 'draft' });
    await done;
    done = once('afterUpdate');
    rt.navigationCommit();
    await done;

    document.body.insertAdjacentHTML(
      'beforeend',
      '<section data-payload-owner="global:home"><div data-payload-fragment="own-late" data-payload-depends="title"></div></section>' +
        '<section data-payload-owner="global:other"><div data-payload-fragment="foreign-late" data-payload-depends="title"></div></section>' +
        '<div data-payload-fragment="unowned-late" data-payload-depends="title"></div>',
    );
    await vi.waitFor(() => {
      expect(rendered).toEqual(['own-late']);
    });
  });
});
