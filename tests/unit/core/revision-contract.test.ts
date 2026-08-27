import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * The public revision contract (roadmap 1.1.0): every lifecycle event says
 * when its message was accepted and what produced it, `superseded` counts
 * abandoned updates only, and `completed` counts the ones whose flush ran.
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
    target.element.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  },
};

let emitter: EventEmitter;
let runtime: LivePreviewRuntime;

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'payload-live-preview', data }, origin: TRUSTED }),
  );
}

function afterUpdate(): Promise<Parameters<Parameters<typeof emitter.on<'afterUpdate'>>[1]>[0]> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', (event) => {
      resolve(event);
    });
  });
}

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML =
    '<div data-payload-owner="global:t"><p data-payload-field="title">t</p></div>';
  emitter = new EventEmitter();
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
});

afterEach(() => {
  runtime.destroy();
});

describe('event metadata', () => {
  it('stamps beforeUpdate, elementUpdate and afterUpdate with receivedAt and source', async () => {
    const before = Date.now();
    const seen: {
      event: string;
      receivedAt: number | undefined;
      source: string | undefined;
      revision: number | undefined;
    }[] = [];
    emitter.on('beforeUpdate', (e) => {
      seen.push({
        event: 'before',
        receivedAt: e.receivedAt,
        source: e.source,
        revision: e.revision,
      });
    });
    emitter.on('elementUpdate', (e) => {
      seen.push({
        event: 'element',
        receivedAt: e.receivedAt,
        source: e.source,
        revision: e.revision,
      });
    });
    const done = afterUpdate();
    post({ title: 'one' });
    const after = await done;
    seen.push({
      event: 'after',
      receivedAt: after.receivedAt,
      source: after.source,
      revision: after.revision,
    });

    expect(seen.map((s) => s.event)).toEqual(['before', 'element', 'after']);
    for (const entry of seen) {
      expect(entry.source, entry.event).toBe('patch');
      expect(entry.receivedAt, entry.event).toBeGreaterThanOrEqual(before);
      expect(entry.receivedAt, entry.event).toBeLessThanOrEqual(Date.now());
      expect(entry.revision, entry.event).toBe(after.revision);
    }
    // One message, one timestamp: every event of the revision shares it.
    expect(new Set(seen.map((s) => s.receivedAt)).size).toBe(1);
  });
});

describe('superseded and completed', () => {
  it('counts a message that arrives before the previous flush as superseding it', async () => {
    const done = afterUpdate();
    post({ title: 'one' });
    post({ title: 'two' });
    await done;
    const { revisions } = runtime.inspect();
    expect(revisions.accepted).toBe(2);
    expect(revisions.superseded).toBe(1);
    expect(revisions.completed).toBe(1);
  });

  it('does not count a message that arrives after the previous update completed', async () => {
    let done = afterUpdate();
    post({ title: 'one' });
    await done;
    done = afterUpdate();
    post({ title: 'two' });
    await done;
    done = afterUpdate();
    post({ title: 'three' });
    await done;
    const { revisions } = runtime.inspect();
    expect(revisions.accepted).toBe(3);
    expect(revisions.superseded).toBe(0);
    expect(revisions.completed).toBe(3);
  });

  it('completes an update whose flush applied nothing, so the next message does not count as superseding it', async () => {
    let done = afterUpdate();
    post({ title: 'one' });
    await done;
    // Same value again: with the default renderer this still writes, so use a
    // field nothing is bound to — the flush runs and applies zero writes.
    post({ unbound: 'x' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(runtime.inspect().revisions.completed).toBe(2);
    done = afterUpdate();
    post({ title: 'two' });
    await done;
    expect(runtime.inspect().revisions.superseded).toBe(0);
    expect(runtime.inspect().revisions.completed).toBe(3);
  });
});
