import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { RuntimeOptions } from '@core/runtime-options';
import type { FieldRenderer } from '@core/types';

/**
 * The two reveal cases the single-document tests cannot reach: several
 * documents sharing a page, and a field the server renders behind a fragment
 * boundary. jsdom reports every element off-screen and has no scrollIntoView,
 * so we install a spy and assert which element it was called on.
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
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
let scrolled: string[];

function start(overrides: Partial<RuntimeOptions> = {}): LivePreviewRuntime {
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
    eventSourcePolicy: 'any',
    revealEditedField: true,
    ...overrides,
  });
  runtime.start();
  return runtime;
}

function post(message: Record<string, unknown>): Promise<void> {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', ...message },
      origin: TRUSTED,
    }),
  );
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => resolve());
    setTimeout(resolve, 60);
  });
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
    // The owner tells the two `title` bindings apart.
    const owner = this.closest('[data-payload-owner]')?.getAttribute('data-payload-owner');
    scrolled.push(owner ?? this.getAttribute('data-payload-field') ?? this.tagName);
  };
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  vi.restoreAllMocks();
});

describe('revealEditedField with several documents on one page', () => {
  it('reveals the binding owned by the document the message describes', async () => {
    document.body.innerHTML =
      '<section data-payload-owner="collection:posts:1"><p data-payload-field="title">old</p></section>' +
      '<section data-payload-owner="collection:posts:2"><p data-payload-field="title">old</p></section>';
    start({ scopeBindingsByOwner: true });

    await post({ collectionSlug: 'posts', data: { id: '2', title: 'a' } });
    expect(scrolled).toEqual([]);

    await post({ collectionSlug: 'posts', data: { id: '2', title: 'a2' } });
    expect(scrolled).toEqual(['collection:posts:2']);
  });
});

describe('revealEditedField behind a fragment boundary', () => {
  it('reveals the edited field the server rendered, after the fragment lands', async () => {
    document.body.innerHTML =
      '<section data-payload-fragment="hero"><p data-payload-field="title">old</p></section>';
    const boundary = document.querySelector('[data-payload-fragment]');
    if (boundary === null) throw new Error('fixture is missing the boundary');
    const order: string[] = [];
    start({
      strategies: {
        fragment: {
          plan: (_root, changed) => (changed.has('title') ? [boundary] : []),
          render: (context, boundaries) => {
            for (const element of boundaries) {
              context.morph(
                element,
                `<p data-payload-field="title">${String(context.fields['title'])}</p>`,
              );
              order.push('rendered');
              context.rendered(element, 'hero', undefined);
            }
            return Promise.resolve({ rendered: boundaries.length, failed: 0, superseded: 0 });
          },
        },
      },
    });

    await post({ data: { title: 'a' } });
    expect(scrolled).toEqual([]);

    await post({ data: { title: 'a2' } });
    expect(scrolled).toEqual(['title']);
    // The element only exists in its final form after the morph.
    expect(order).toEqual(['rendered', 'rendered']);
  });
});
