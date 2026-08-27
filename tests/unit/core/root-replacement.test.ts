import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * Root replacement (F-36): a framework that swaps `document.body` must not
 * leave the runtime observing a detached node. The sentinel on `<html>`
 * follows the new body on its own; `refreshCache()` (the navigation hook)
 * follows it synchronously.
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

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data },
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
function start(): LivePreviewRuntime {
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
  return runtime;
}
/** Replace `document.body` the way a framework's app shell does, returning the old one. */
function swapBody(markup: string): HTMLElement {
  const old = document.body;
  const next = document.createElement('body');
  next.innerHTML = markup;
  document.body = next;
  return old;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  document.body.innerHTML = '<p data-payload-field="title">old</p>';
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('root replacement', () => {
  it('follows a swapped document.body through the sentinel and patches bindings in the new one', async () => {
    const rt = start();
    const old = swapBody('<h1 data-payload-field="title">fresh</h1>');
    await tick();
    expect(rt.inspect().bindings.elements).toBe(1);
    const done = afterUpdate();
    post({ title: 'new' });
    await done;
    expect(document.querySelector('h1')?.textContent).toBe('new');
    expect(old.querySelector('p')?.textContent).toBe('old');
  });

  it('keeps observing the new body: a binding added there later is picked up', async () => {
    const rt = start();
    swapBody('<div id="host"></div>');
    await tick();
    expect(rt.inspect().bindings.elements).toBe(0);
    document.getElementById('host')!.innerHTML = '<span data-payload-field="title">late</span>';
    // The structural observer debounces; wait past it.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(rt.inspect().bindings.elements).toBe(1);
    const done = afterUpdate();
    post({ title: 'seen' });
    await done;
    expect(document.querySelector('span')?.textContent).toBe('seen');
  });

  it('refreshCache() follows the replaced body synchronously, before the sentinel fires', () => {
    const rt = start();
    swapBody('<h1 data-payload-field="title">fresh</h1><h2 data-payload-field="lede"></h2>');
    rt.refreshCache();
    expect(rt.inspect().bindings.elements).toBe(2);
  });

  it('does nothing for a stopped runtime and survives repeated swaps', async () => {
    const rt = start();
    swapBody('<p data-payload-field="title">one</p>');
    await tick();
    swapBody('<p data-payload-field="title">two</p><p data-payload-field="title">three</p>');
    await tick();
    expect(rt.inspect().bindings.elements).toBe(2);
    rt.destroy();
    swapBody('<p data-payload-field="title">four</p>');
    await tick();
    rt.refreshCache();
    expect(rt.inspect().bindings.elements).toBe(0);
  });
});
