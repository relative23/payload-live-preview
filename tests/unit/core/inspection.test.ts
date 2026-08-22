import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { VERSION } from '../../../src/version';
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

const PAGE = `
  <div data-payload-owner="global:homepage">
    <h1 data-payload-field="title">page title</h1>
    <p data-payload-field="subtitle">page subtitle</p>
  </div>
  <article data-payload-owner="collection:services:73">
    <h2 data-payload-field="title">service 73</h2>
  </article>
`;

function createRuntime(options: Record<string, unknown> = {}): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: () => {},
    ...options,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = PAGE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('inspect() before the runtime starts', () => {
  it('reports a stopped runtime without inventing state', () => {
    const runtime = createRuntime();
    const snapshot = runtime.inspect();

    expect(snapshot.started).toBe(false);
    expect(snapshot.status).toBe('disconnected');
    expect(snapshot.version).toBe(VERSION);
    // No cache is built before start, so the DOM bindings are not yet counted.
    expect(snapshot.bindings.elements).toBe(0);
    expect(snapshot.bindings.fieldNames).toEqual([]);
    expect(snapshot.revisions).toEqual({
      accepted: 0,
      superseded: 0,
      active: undefined,
    });
    expect(snapshot.scheduler.lastFlush).toBeUndefined();
    runtime.destroy();
  });
});

describe('inspect() on a started runtime', () => {
  it('reports the bindings, owners and renderers the page actually offers', () => {
    const runtime = createRuntime();
    runtime.start();
    const snapshot = runtime.inspect();

    expect(snapshot.started).toBe(true);
    expect(snapshot.bindings.elements).toBe(3);
    expect(snapshot.bindings.fields).toBe(2);
    expect(snapshot.bindings.fieldNames).toEqual(['subtitle', 'title']);
    expect(snapshot.bindings.owners).toEqual(['collection:services:73', 'global:homepage']);
    expect(snapshot.bindings.ownerScoped).toBe(false);
    expect(snapshot.renderers).toEqual(['text']);
    expect(snapshot.origins.trusted).toEqual([TRUSTED]);
    runtime.destroy();
  });

  it('reports owner scoping when it is on', () => {
    const runtime = createRuntime({ scopeBindingsByOwner: true });
    runtime.start();
    expect(runtime.inspect().bindings.ownerScoped).toBe(true);
    runtime.destroy();
  });

  it('reads the locked origin through the hook the host supplies', () => {
    let locked: string | undefined = undefined;
    const runtime = createRuntime({ lockedOrigin: () => locked });
    runtime.start();

    expect(runtime.inspect().origins.locked).toBeUndefined();
    locked = TRUSTED;
    expect(runtime.inspect().origins.locked).toBe(TRUSTED);
    runtime.destroy();
  });

  it('does not hand out a live view into runtime state', () => {
    const runtime = createRuntime();
    runtime.start();
    const snapshot = runtime.inspect();
    const before = [...snapshot.bindings.fieldNames];

    document.body.innerHTML = '<p data-payload-field="other">x</p>';
    runtime.refreshCache();

    // The snapshot is a copy; a later cache rebuild must not rewrite it.
    expect(snapshot.bindings.fieldNames).toEqual(before);
    expect(runtime.inspect().bindings.fieldNames).toEqual(['other']);
    runtime.destroy();
  });
});

describe('inspect() revision accounting', () => {
  it('counts accepted updates and the flush they produced', async () => {
    const runtime = createRuntime();
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'next' } });
    await vi.advanceTimersByTimeAsync(50);

    const snapshot = runtime.inspect();
    expect(snapshot.revisions.accepted).toBe(1);
    expect(snapshot.revisions.superseded).toBe(0);
    expect(snapshot.scheduler.lastFlush?.applied).toBeGreaterThan(0);
    expect(snapshot.status).toBe('connected');
    runtime.destroy();
  });

  it('counts an update that a newer one overtook before it finished', async () => {
    const runtime = createRuntime({ debounceMs: 20 });
    runtime.start();

    // Two updates inside one debounce window: the first is still the active
    // transaction when the second is accepted, which is the supersession the
    // counter exists to make visible.
    fireMessage({ type: 'payload-live-preview', data: { title: 'first' } });
    fireMessage({ type: 'payload-live-preview', data: { title: 'second' } });
    await vi.advanceTimersByTimeAsync(50);

    const snapshot = runtime.inspect();
    expect(snapshot.revisions.accepted).toBe(2);
    expect(snapshot.revisions.superseded).toBe(1);
    runtime.destroy();
  });

  it('names a field that arrived but matched no binding', async () => {
    const runtime = createRuntime();
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { nosuchfield: 'x' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(runtime.inspect().bindings.orphanFields).toContain('nosuchfield');
    runtime.destroy();
  });
});

describe('inspect() visibility gate', () => {
  it('reports the threshold and whether it is deferring', () => {
    const runtime = createRuntime({
      disableVisibilityGate: false,
      visibilityGateThreshold: 2,
    });
    runtime.start();

    // Three bound elements against a threshold of two: the gate is live, which
    // is precisely the state that looked like a broken runtime in F-39.
    const snapshot = runtime.inspect();
    expect(snapshot.scheduler.visibilityGateThreshold).toBe(2);
    expect(snapshot.scheduler.visibilityGateActive).toBe(true);
    runtime.destroy();
  });

  it('reports the gate as inactive below the threshold', () => {
    const runtime = createRuntime({
      disableVisibilityGate: false,
      visibilityGateThreshold: 50,
    });
    runtime.start();
    expect(runtime.inspect().scheduler.visibilityGateActive).toBe(false);
    runtime.destroy();
  });
});

describe('inspect() protocol view', () => {
  it('reports our version before the remote party announces one', () => {
    const runtime = createRuntime();
    runtime.start();
    const { protocol } = runtime.inspect();

    expect(protocol.theirs).toBeUndefined();
    expect(protocol.negotiated).toBeLessThanOrEqual(protocol.ours);
    expect(Array.isArray(protocol.capabilities)).toBe(true);
    runtime.destroy();
  });

  it('records an announced version that does not move the negotiated one', async () => {
    // Regression: the negotiation guard compared only `negotiated`, so a
    // remote announcing version 1 — which negotiates to 1 either way — stayed
    // indistinguishable from a remote that never announced anything.
    const runtime = createRuntime();
    runtime.start();
    expect(runtime.inspect().protocol.negotiated).toBe(1);

    fireMessage({ type: 'payload-live-preview', protocolVersion: 1, data: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(runtime.inspect().protocol.theirs).toBe(1);
    expect(runtime.protocol.theirs).toBe(1);
    runtime.destroy();
  });

  it('reports the negotiated version once the remote party announces one', async () => {
    const runtime = createRuntime();
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      protocolVersion: 1,
      data: { title: 'x' },
    });
    await vi.advanceTimersByTimeAsync(50);

    const { protocol } = runtime.inspect();
    expect(protocol.theirs).toBe(1);
    expect(protocol.negotiated).toBe(1);
    runtime.destroy();
  });
});
