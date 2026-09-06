import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreviewRuntime } from '@core/lifecycle';
import { EventEmitter } from '@events/emitter';
import { buildBuiltinRenderers } from '@field-types/index';
import { IO } from '../../integration/runtime-harness';

/**
 * Protocol drift, made visible. This package mirrors Payload's postMessage
 * format by hand, so a newer admin can send something this runtime does not
 * know — and until now that message was dropped in silence, which looks exactly
 * like "live preview is broken" from the outside.
 *
 * The origin check runs first, so LP0503 only ever describes a sender the page
 * already trusts: drift, not an attack.
 */

const ADMIN = 'https://admin.example.com';

interface Harness {
  readonly runtime: LivePreviewRuntime;
  readonly warnings: string[];
}

function start(): Harness {
  const warnings: string[] = [];
  const runtime = new LivePreviewRuntime({
    renderers: buildBuiltinRenderers(),
    originMatcher: (origin) => origin === ADMIN,
    readyTargets: [],
    emitter: new EventEmitter(),
    eventSourcePolicy: 'any',
    warn: (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    },
  });
  runtime.start();
  return { runtime, warnings };
}

function send(data: unknown, origin = ADMIN): void {
  window.dispatchEvent(new MessageEvent('message', { origin, data }));
}

let harness: Harness | undefined;

beforeEach(() => {
  // jsdom has no IntersectionObserver, and the visibility gate builds one.
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = '<h1 data-payload-field="title">t</h1>';
  harness = start();
});

afterEach(() => {
  harness?.runtime.destroy();
  harness = undefined;
  vi.restoreAllMocks();
});

describe('LP0503: a trusted origin sends something this runtime does not know', () => {
  it('reports a message whose shape is wrong', () => {
    // `data` must be a plain object; a string is the shape guard's business.
    send({ type: 'payload-live-preview', data: 'not-an-object' });

    const reported = harness?.warnings.filter((line) => line.includes('LP0503')) ?? [];
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('unexpected shape');
    expect(reported[0]).toContain(ADMIN);
  });

  it('reports a message type this version has no meaning for', () => {
    send({ type: 'payload-live-preview-something-new', field: 'title' });

    const reported = harness?.warnings.filter((line) => line.includes('LP0503')) ?? [];
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('unknown message type');
  });

  it('says it once, however many the admin sends', () => {
    // A drifting sender repeats the same shape on every keystroke; one line is
    // information, thirty are noise that hides the rest of the console.
    for (let index = 0; index < 5; index += 1) {
      send({ type: 'payload-live-preview', data: index });
    }

    expect(harness?.warnings.filter((line) => line.includes('LP0503'))).toHaveLength(1);
  });

  it('stays silent for an origin the page does not trust', () => {
    send({ type: 'payload-live-preview', data: 'not-an-object' }, 'https://evil.example.com');

    expect(harness?.warnings.filter((line) => line.includes('LP0503'))).toHaveLength(0);
  });

  it('stays silent for a message it understands', async () => {
    send({ type: 'payload-live-preview', data: { title: 'Typed' } });
    await vi.waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toBe('Typed');
    });

    expect(harness?.warnings.filter((line) => line.includes('LP0503'))).toHaveLength(0);
  });
});
