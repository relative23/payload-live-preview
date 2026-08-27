import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { ElementCache } from '@core/cache';
import {
  dependencyMapFromBinding,
  mergeDependencyMaps,
  parseDependencyList,
} from '@core/dependencies';
import type { FieldRenderer } from '@core/types';

/**
 * Roadmap 1.3.0, "conditional and derived markup ergonomics":
 * `data-payload-depends` feeds the same dependency map the `dependencies`
 * option does, `data-payload-strategy` other than `patch` is left alone
 * with a diagnostic, and a `data-payload-boundary` anchor hides itself
 * while its field is empty.
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
const renders: string[] = [];
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    renders.push(target.fieldName);
    target.element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  },
};

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'payload-live-preview', data }, origin: TRUSTED }),
  );
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}
function start(options: { skipUnchanged?: boolean; warn?: (...args: unknown[]) => void } = {}) {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: options.warn ?? (() => {}),
    ...(options.skipUnchanged !== undefined ? { skipUnchanged: options.skipUnchanged } : {}),
  });
  runtime.start();
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  renders.length = 0;
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('dependency parsing', () => {
  it('reads comma- and space-separated names once each, in order', () => {
    expect(parseDependencyList('price, currency price  tax')).toEqual(['price', 'currency', 'tax']);
    expect(parseDependencyList('')).toEqual([]);
    expect(parseDependencyList(null)).toEqual([]);
  });

  it('turns a binding declaration into the source → dependents map and merges maps', () => {
    expect(dependencyMapFromBinding('priceLabel', ['price', 'currency', 'priceLabel'])).toEqual({
      price: ['priceLabel'],
      currency: ['priceLabel'],
    });
    expect(
      mergeDependencyMaps(
        { price: ['priceLabel'] },
        { price: ['total', 'priceLabel'], tax: ['total'] },
      ),
    ).toEqual({ price: ['priceLabel', 'total'], tax: ['total'] });
  });

  it('is read by the cache from data-payload-depends', () => {
    document.body.innerHTML =
      '<p data-payload-field="priceLabel" data-payload-depends="price currency"></p><p data-payload-field="price"></p>';
    const cache = new ElementCache();
    cache.buildFromRoot(document);
    expect(cache.dependencyMap()).toEqual({ price: ['priceLabel'], currency: ['priceLabel'] });
  });
});

describe('data-payload-depends with skipUnchanged', () => {
  it('re-applies the dependent when its source changed even though its own value did not', async () => {
    document.body.innerHTML =
      '<p data-payload-field="price">1</p><p data-payload-field="priceLabel" data-payload-depends="price">x</p>';
    start({ skipUnchanged: true });
    let done = afterUpdate();
    post({ price: '1', priceLabel: 'one' });
    await done;
    renders.length = 0;
    done = afterUpdate();
    post({ price: '2', priceLabel: 'one' });
    await done;
    expect(renders).toEqual(['price', 'priceLabel']);
    renders.length = 0;
    post({ price: '2', priceLabel: 'one', other: 'z' });
    // Nothing changed for either binding: the skip applies to both.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(renders).toEqual([]);
  });
});

describe('data-payload-strategy', () => {
  it('leaves a binding with a strategy other than patch alone and says why once', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title" data-payload-strategy="fragment">old</p><p data-payload-field="subtitle" data-payload-strategy="patch">old</p>';
    const warn = vi.fn();
    start({ warn });
    const done = afterUpdate();
    post({ title: 'new', subtitle: 'new' });
    await done;
    expect(document.querySelector('[data-payload-field="title"]')?.textContent).toBe('old');
    expect(document.querySelector('[data-payload-field="subtitle"]')?.textContent).toBe('new');
    post({ title: 'newer', subtitle: 'newer' });
    await afterUpdate();
    const hits = warn.mock.calls.filter((c) => String(c[0]).includes('LP0407'));
    expect(hits).toHaveLength(1);
    expect(String(hits[0]?.[0])).toContain('fragment');
  });
});

describe('data-payload-boundary', () => {
  it('unhides the anchor when the field gets a value and hides it again when emptied', async () => {
    document.body.innerHTML = '<p data-payload-field="subtitle" data-payload-boundary hidden></p>';
    const anchor = document.querySelector('p') as HTMLElement;
    start();
    let done = afterUpdate();
    post({ subtitle: 'Now present' });
    await done;
    expect(anchor.hasAttribute('hidden')).toBe(false);
    expect(anchor.textContent).toBe('Now present');
    done = afterUpdate();
    post({ subtitle: '' });
    await done;
    expect(anchor.hasAttribute('hidden')).toBe(true);
  });
});
