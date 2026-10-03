/**
 * An endpoint depth refusal follows the HTTP client's failure path.
 * The preview must still display the current revision through its DOM fallback.
 */
import { describe, expect, it, vi } from 'vitest';
import { createFragmentEndpoint } from '@adapters/astro/fragments';
import { LivePreviewRuntime } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import { createFragmentStrategy } from '@fragment/index';

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

describe('fragment depth refusal fallback', () => {
  it('reports LP0801 and shows the current unsaved value after an endpoint depth refusal', async () => {
    const verify = vi.fn(() => ({ subject: 'review-editor' }));
    const props = vi.fn(() => ({ title: 'server' }));
    const render = vi.fn(() => Promise.resolve('<h1>server</h1>'));
    const server = createFragmentEndpoint({
      registry: { hero: { component: {}, props } },
      authorize: { type: 'verifier', verify },
      render,
      limits: { fieldDepth: 0 },
    });
    let response: Response | undefined;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      const result = await server({
        request: new Request(new URL(path, 'https://site.example.com'), init),
      });
      response = result.clone();
      return result;
    });
    const previous = document.body.innerHTML;
    vi.stubGlobal('IntersectionObserver', IO);
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><h1 data-payload-field="title">saved</h1></section>';
    const emitter = new EventEmitter();
    const failure = new Promise((resolve) => {
      emitter.once('error', resolve);
    });
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: {
          name: 'text',
          render(target, value) {
            target.element.textContent = String(value);
          },
        },
      },
      originMatcher: (origin) => origin === 'https://admin.example.com',
      readyTargets: ['https://admin.example.com'],
      emitter,
      debounceMs: 0,
      heartbeatMs: 600000,
      disableVisibilityGate: true,
      enableA11y: false,
      strategies: {
        fragment: createFragmentStrategy({
          endpoint: '/payload/fragment',
          fetch,
          location: { pathname: '/page', search: '?preview=true' },
        }),
      },
    });
    try {
      runtime.start();
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'https://admin.example.com',
          data: {
            type: 'payload-live-preview',
            globalSlug: 'home',
            data: { title: 'Current unsaved value' },
          },
        }),
      );
      expect(await failure).toMatchObject({ code: 'LP0801', context: 'fragment' });
      // A failed render patches the DOM; the fragment afterUpdate is emitted only for successful renders.
      await vi.waitFor(() => {
        expect(document.querySelector('h1')?.textContent).toBe('Current unsaved value');
        expect(runtime.inspect().fragments).toMatchObject({ rendered: 0, failed: 1 });
      });
      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({ error: 'field-depth', maxDepth: 0 });
      expect(document.querySelector('h1')?.textContent).toBe('Current unsaved value');
      expect(runtime.inspect().fragments).toMatchObject({ rendered: 0, failed: 1 });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(verify).not.toHaveBeenCalled();
      expect(props).not.toHaveBeenCalled();
      expect(render).not.toHaveBeenCalled();
    } finally {
      runtime.destroy();
      vi.unstubAllGlobals();
      document.body.innerHTML = previous;
    }
  });
});
