import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
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

function fireMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: TRUSTED }));
}

function textRenderer(): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      target.element.textContent =
        value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

/**
 * One page previewing three documents that all expose a field called `title`:
 * the page global, shared SEO metadata, and two rows of a collection.
 */
const MULTI_DOCUMENT_PAGE = `
  <div data-payload-owner="global:homepage">
    <h1 data-payload-field="title">page title</h1>
  </div>
  <head-meta data-payload-owner="global:global-seo">
    <span data-payload-field="title">seo title</span>
  </head-meta>
  <article data-payload-owner="collection:services:73">
    <h2 data-payload-field="title">service 73</h2>
  </article>
  <article data-payload-owner="collection:services:74">
    <h2 data-payload-field="title">service 74</h2>
  </article>
  <footer>
    <span data-payload-field="title">unowned</span>
  </footer>
`;

interface PageTexts {
  readonly page: string;
  readonly seo: string;
  readonly service73: string;
  readonly service74: string;
  readonly unowned: string;
}

function texts(): PageTexts {
  const read = (selector: string): string => {
    const element = document.querySelector(selector);
    return element === null ? '' : element.textContent.trim();
  };
  return {
    page: read('[data-payload-owner="global:homepage"] [data-payload-field="title"]'),
    seo: read('[data-payload-owner="global:global-seo"] [data-payload-field="title"]'),
    service73: read('[data-payload-owner="collection:services:73"] [data-payload-field="title"]'),
    service74: read('[data-payload-owner="collection:services:74"] [data-payload-field="title"]'),
    unowned: read('footer [data-payload-field="title"]'),
  };
}

function createRuntime(options: { readonly scopeBindingsByOwner?: boolean } = {}): {
  runtime: LivePreviewRuntime;
  warnings: string[];
} {
  const warnings: string[] = [];
  const runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
    ...options,
  });
  return { runtime, warnings };
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = MULTI_DOCUMENT_PAGE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('owner scoping disabled (1.x default)', () => {
  it('lets one document overwrite every same-named binding on the page', async () => {
    const { runtime } = createRuntime();
    runtime.start();
    fireMessage({ type: 'payload-live-preview', globalSlug: 'homepage', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    // This is F-32 itself: the field name was the only identity.
    expect(texts()).toEqual({
      page: 'new',
      seo: 'new',
      service73: 'new',
      service74: 'new',
      unowned: 'new',
    });
    runtime.destroy();
  });
});

describe('owner scoping enabled', () => {
  it('patches only the global the message names', async () => {
    const { runtime } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', globalSlug: 'homepage', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(texts()).toEqual({
      page: 'new',
      seo: 'seo title',
      service73: 'service 73',
      service74: 'service 74',
      unowned: 'unowned',
    });
    runtime.destroy();
  });

  it('patches only the exact collection document the message names', async () => {
    const { runtime } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'services',
      data: { id: 73, title: 'renamed' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(texts()).toEqual({
      page: 'page title',
      seo: 'seo title',
      service73: 'renamed',
      service74: 'service 74',
      unowned: 'unowned',
    });
    runtime.destroy();
  });

  it('leaves every exact document row untouched when the id is unproven', async () => {
    const { runtime } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'services',
      data: { title: 'renamed' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(texts().service73).toBe('service 73');
    expect(texts().service74).toBe('service 74');
    runtime.destroy();
  });

  it('never writes a binding that claims no owner', async () => {
    const { runtime } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    for (const message of [
      { type: 'payload-live-preview', globalSlug: 'homepage', data: { title: 'a' } },
      { type: 'payload-live-preview', collectionSlug: 'services', data: { id: 73, title: 'b' } },
    ]) {
      fireMessage(message);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(texts().unowned).toBe('unowned');
    runtime.destroy();
  });

  it('fails closed and warns once when a message names no document', async () => {
    const { runtime, warnings } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({ type: 'payload-live-preview', data: { title: 'newer' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(texts().page).toBe('page title');
    expect(warnings.filter((line) => line.includes('scopeBindingsByOwner'))).toHaveLength(1);
    runtime.destroy();
  });

  it('inherits the owner from the nearest ancestor and lets a nested document override it', async () => {
    document.body.innerHTML = `
      <section data-payload-owner="global:homepage">
        <h1 data-payload-field="title">page title</h1>
        <div><p data-payload-field="intro">page intro</p></div>
        <article data-payload-owner="collection:services:73">
          <h2 data-payload-field="title">service 73</h2>
        </article>
      </section>
    `;
    const { runtime } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'new', intro: 'new intro' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('h1')?.textContent).toBe('new');
    expect(document.querySelector('p')?.textContent).toBe('new intro');
    expect(document.querySelector('h2')?.textContent).toBe('service 73');
    runtime.destroy();
  });

  it('does not report another document as a missing anchor', async () => {
    const { runtime, warnings } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'not-on-this-page',
      data: { title: 'new', subtitle: 'also new' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(warnings.filter((line) => line.includes('no'))).toEqual([]);
    runtime.destroy();
  });

  it('still reports a genuinely missing anchor inside the addressed document', async () => {
    const { runtime, warnings } = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      data: { title: 'new', tagline: 'has no anchor' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(warnings.some((line) => line.includes('tagline'))).toBe(true);
    runtime.destroy();
  });
});
