/**
 * LP0809 when the page never defined Astro's island element at all: fragment
 * scripts never run, so an inserted island cannot start and the runtime says
 * which part of the page's own bootstrap is missing (ADR 0021). This realm
 * deliberately defines no `astro-island`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const warnings: string[] = [];
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;

const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  warnings.length = 0;
  document.body.innerHTML =
    '<section data-payload-fragment="card"><h2 data-payload-field="title">Saved</h2></section>';
});

afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('fragment islands on a page without Astro islands (ADR 0021)', () => {
  it("names Astro's island element as what the page never loaded", async () => {
    const fragment: FragmentHandler = (request) =>
      Promise.resolve({
        status: 'rendered',
        html:
          `<h2 data-payload-field="title">${String(request.fields['title'])}</h2>` +
          '<astro-island component-url="/_astro/Panel.js" renderer-url="/_astro/client.js" client="load" ssr props="{}"></astro-island>',
      });
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
    const rendered = new Promise((resolve) => {
      emitter.once('fragmentRender', resolve);
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview', data: { title: 'Unsaved' }, globalSlug: 'home' },
        origin: TRUSTED,
      }),
    );
    await rendered;

    expect(customElements.get('astro-island')).toBeUndefined();
    expect(warnings.filter((message) => message.includes('LP0809'))).toEqual([
      '[live-preview] LP0809: a fragment island cannot start: this page never loaded <astro-island>; render one on the page',
    ]);
  });
});
