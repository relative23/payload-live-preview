/**
 * Runtime behaviours added for real-world Payload/Astro compatibility:
 *
 *   - deferred startup while the document is still parsing (script in
 *     `<head>` — `document.body` is null at execute time)
 *   - Lexical auto-detection for rich-text values bound without
 *     `data-payload-richtext`
 *   - `data-payload-attribute` writes
 *   - REST data merging via the `dataMerge` option
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';
import type { FieldRenderer } from '@core/types';

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

function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function textRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

function makeRuntime(
  overrides: Partial<ConstructorParameters<typeof LivePreviewRuntime>[0]> = {},
): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (o) => o === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    disableVisibilityGate: true,
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('deferred startup while the document is parsing', () => {
  it('waits for DOMContentLoaded when readyState is loading', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const runtime = makeRuntime();
    expect(runtime.start()).toBe(true);

    // Not yet listening: a message before DOMContentLoaded is ignored.
    fireMessage({ type: 'payload-live-preview', data: { title: 'early' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('old');

    readyState.mockReturnValue('interactive');
    document.dispatchEvent(new Event('DOMContentLoaded'));

    fireMessage({ type: 'payload-live-preview', data: { title: 'after ready' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('after ready');

    runtime.destroy();
    readyState.mockRestore();
  });

  it('destroy() before DOMContentLoaded cancels the pending startup', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const readyState = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');

    const runtime = makeRuntime();
    runtime.start();
    runtime.destroy();

    readyState.mockReturnValue('complete');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('old');
    readyState.mockRestore();
  });
});

describe('Lexical auto-detection without data-payload-richtext', () => {
  it('renders a Lexical value bound to a plain element as rich text', async () => {
    document.body.innerHTML = '<div data-payload-field="body">old</div>';
    const runtime = makeRuntime({ renderers: buildBuiltinRenderers() });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: {
        body: {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', text: 'Hallo Welt' }],
              },
            ],
          },
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    const div = document.querySelector('[data-payload-field="body"]');
    expect(div?.innerHTML).toContain('<p');
    expect(div?.textContent).toContain('Hallo Welt');
    expect(div?.textContent).not.toContain('[object Object]');
    runtime.destroy();
  });

  it('does not override an explicit data-payload-type', async () => {
    document.body.innerHTML =
      '<div data-payload-field="body" data-payload-type="text">old</div>';
    const rendered: unknown[] = [];
    const runtime = makeRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (target, value) => {
            rendered.push(value);
            target.element.textContent = 'text-renderer';
          },
        },
      },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { body: { root: { children: [] } } },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(rendered).toHaveLength(1);
    runtime.destroy();
  });
});

describe('data-payload-attribute bindings', () => {
  it('writes the value into the declared attribute', async () => {
    document.body.innerHTML =
      '<time data-payload-field="publishedAt" data-payload-attribute="datetime">x</time>';
    const runtime = makeRuntime();
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { publishedAt: '2026-07-11' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe('2026-07-11');
    // Content untouched — attribute bindings do not render into the element.
    expect(document.querySelector('time')?.textContent).toBe('x');
    runtime.destroy();
  });

  it('refuses unsafe attribute writes and warns', async () => {
    document.body.innerHTML =
      '<div data-payload-field="x" data-payload-attribute="onclick">x</div>';
    const warn = vi.fn();
    const runtime = makeRuntime({ warn });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'alert(1)' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('div[data-payload-field]')?.hasAttribute('onclick')).toBe(false);
    expect(warn).toHaveBeenCalled();
    runtime.destroy();
  });
});

describe('dataMerge option (Payload 3.x REST merging)', () => {
  it('renders the merged document instead of the raw form values', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '1', title: 'merged title' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw title' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(document.querySelector('h1')?.textContent).toBe('merged title');
    runtime.destroy();
  });

  it('falls back to raw values when the merge fetch fails', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { id: '1', title: 'raw title' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('raw title');
    runtime.destroy();
  });

  it('skips merging entirely for messages without slugs', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const fetchFn = vi.fn();
    const runtime = makeRuntime({
      dataMerge: { serverURL: 'https://cms.example.com', fetchFn: fetchFn as typeof fetch },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'no slug' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(document.querySelector('h1')?.textContent).toBe('no slug');
    runtime.destroy();
  });
});
