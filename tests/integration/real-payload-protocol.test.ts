/**
 * Real Payload protocol contract test.
 *
 * The Astro E2E suite proves `postMessage → runtime → DOM`, but its
 * `/admin` page *emulates* Payload and crafts the messages itself. This
 * test closes the remaining gap — "does our runtime handle the message
 * a REAL Payload admin actually sends?" — using a fixture captured
 * verbatim from a running Payload 3.85 admin (see
 * `tests/fixtures/real-payload-message.json`).
 *
 * It drives the message through the REAL `MessageBus` + the REAL
 * `LivePreviewRuntime` (no mocks of either) in jsdom and asserts:
 *   1. the message passes the bus's shape validation (dispatched, not
 *      dropped as `'shape'`);
 *   2. bound elements update — a text field, a rich-text field rendered
 *      through the real Lexical renderer, and an array field;
 *   3. the real-world envelope quirks are tolerated: `collectionSlug`
 *      present-but-null on a global, `externallyUpdatedRelationship:
 *      null`, and `_status`/`id` sitting alongside real fields.
 *
 * If Payload changes its wire format in a way our runtime can't handle,
 * this test (together with the weekly protocol-watch) is where it
 * surfaces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { buildBuiltinRenderers } from '@field-types/index';
import realMessage from '../fixtures/real-payload-message.json' with { type: 'json' };

const ADMIN_ORIGIN = 'https://admin.example.com';

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

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('real Payload 3.x protocol', () => {
  it('renders a message captured from a real Payload admin through the real runtime', async () => {
    // A page bound to three fields present in the real payload.
    document.body.innerHTML = `
      <h1 data-payload-field="introTitle">placeholder</h1>
      <div data-payload-field="introText"></div>
      <ul data-payload-field="faq"
          data-payload-type="array"
          data-payload-array-template="<li>{{question}}</li>"></ul>
    `;

    const emitter = new EventEmitter();
    const errors: unknown[] = [];
    emitter.on('error', (e) => {
      errors.push(e);
    });
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: (o) => o === ADMIN_ORIGIN,
      readyTargets: [ADMIN_ORIGIN],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    // Dispatch the REAL captured message exactly as the admin would.
    window.dispatchEvent(new MessageEvent('message', { data: realMessage, origin: ADMIN_ORIGIN }));
    await vi.advanceTimersByTimeAsync(50);

    // 1. It was accepted and processed (connected + counted), no errors.
    expect(errors).toEqual([]);
    expect(runtime.status).toBe('connected');
    expect(runtime.updateCount).toBe(1);

    // 2a. Text field updated to the real value.
    expect(document.querySelector('[data-payload-field="introTitle"]')?.textContent).toBe(
      'Ihr Ort für Thai-Massage und Entspannung in München',
    );

    // 2b. Rich text rendered through the real Lexical renderer (auto-detected).
    const body = document.querySelector('[data-payload-field="introText"]');
    expect(body?.querySelector('p')).not.toBeNull();
    expect(body?.textContent).toContain('Willkommen bei Sala Thai Massage');

    // 2c. Array field rendered from the real faq array.
    const faqItems = document.querySelectorAll('[data-payload-field="faq"] li');
    expect(faqItems).toHaveLength(1);
    expect(faqItems[0]?.textContent).toContain('Unterschied zwischen Thai-Massage');

    runtime.destroy();
  });
});
