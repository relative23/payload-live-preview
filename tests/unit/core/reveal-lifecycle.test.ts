import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * "Reveal the edited section" (roadmap 2.0). Tier 1: when a field's value
 * changes, the preview scrolls to that field. Tier 2: an admin focus message
 * reveals the named field. jsdom reports every element off-screen
 * (getBoundingClientRect → zeros) and has no scrollIntoView, so we install a
 * spy and assert which element it was called on.
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

function start(revealEditedField: boolean): LivePreviewRuntime {
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
    revealEditedField,
  });
  runtime.start();
  return runtime;
}

function post(fields: Record<string, unknown>): Promise<void> {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data: fields },
      origin: TRUSTED,
    }),
  );
  return afterUpdate();
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => resolve());
    setTimeout(resolve, 60);
  });
}
function fieldOf(el: Element | null): string | undefined {
  return el?.getAttribute('data-payload-field') ?? undefined;
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  scrolled = [];
  // jsdom has no scrollIntoView; record the element it is called on.
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element): void {
    scrolled.push(fieldOf(this) ?? this.tagName);
  };
  document.body.innerHTML =
    '<p data-payload-field="title">old</p><p data-payload-field="body">old</p>';
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  vi.restoreAllMocks();
});

describe('revealEditedField (tier 1 — reveal on change)', () => {
  it('does not scroll on the first (baseline) message, then reveals the changed field', async () => {
    start(true);
    await post({ title: 'a', body: 'b' }); // baseline
    expect(scrolled).toEqual([]);

    await post({ title: 'a2', body: 'b' }); // title changed
    expect(scrolled).toEqual(['title']);

    await post({ title: 'a2', body: 'b2' }); // body changed
    expect(scrolled).toEqual(['title', 'body']);
  });

  it('does not re-scroll while the same field keeps changing', async () => {
    start(true);
    await post({ title: 'a', body: 'b' });
    await post({ title: 'a2', body: 'b' });
    await post({ title: 'a3', body: 'b' }); // same field again
    expect(scrolled).toEqual(['title']);
  });

  it('does nothing when the changed field has no bound element', async () => {
    start(true);
    await post({ ghost: 'a' }); // baseline; ghost has no [data-payload-field]
    await post({ ghost: 'b' }); // changed but unbound → no reveal, no throw
    expect(scrolled).toEqual([]);
  });

  it('does nothing when the option is off', async () => {
    start(false);
    await post({ title: 'a', body: 'b' });
    await post({ title: 'a2', body: 'b' });
    expect(scrolled).toEqual([]);
  });
});

describe('reveal on admin focus (tier 2)', () => {
  it('reveals the field named in a payload-live-preview-focus message', async () => {
    start(true);
    await post({ title: 'a', body: 'b' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview-focus', field: 'body' },
        origin: TRUSTED,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(scrolled).toEqual(['body']);
  });

  it('does nothing for a focus message that names a field with no binding', async () => {
    start(true);
    await post({ title: 'a', body: 'b' });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview-focus', field: 'missing' },
        origin: TRUSTED,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(scrolled).toEqual([]);
  });

  it('ignores focus messages when the option is off', async () => {
    start(false);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'payload-live-preview-focus', field: 'body' },
        origin: TRUSTED,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(scrolled).toEqual([]);
  });
});
