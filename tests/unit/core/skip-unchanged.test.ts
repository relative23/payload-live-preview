import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { createTextRenderer } from '@field-types/text';

/**
 * `skipUnchanged` decides, per binding, whether a render happens at all. The
 * cost of a wrong "skip" is a stale page, so every rule that forces a re-apply
 * is pinned here alongside the rule that permits the skip: a new element, a
 * value without an identity, a changed dependency, a refused write, and the
 * option being off at all.
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

function fireMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin: TRUSTED }));
}

/** A renderer that records every write it is asked to perform. */
function recordingRenderer(writes: string[], refuse = new Set<string>()): FieldRenderer {
  return {
    name: 'text',
    render(target, value) {
      if (refuse.has(target.fieldName)) return;
      const printed = typeof value === 'string' ? value : '<object>';
      writes.push(`${target.fieldName}=${printed}`);
      target.element.textContent = printed;
    },
  };
}

const PAGE = `
  <h1 data-payload-field="title">t</h1>
  <p data-payload-field="subtitle">s</p>
  <p data-payload-field="priceLabel">p</p>
`;

function createRuntime(
  writes: string[],
  options: Record<string, unknown> = {},
): LivePreviewRuntime {
  return new LivePreviewRuntime({
    renderers: { text: recordingRenderer(writes) },
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

async function update(data: Record<string, unknown>): Promise<void> {
  fireMessage({ type: 'payload-live-preview', data });
  await vi.advanceTimersByTimeAsync(20);
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = IO;
  document.body.innerHTML = PAGE;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('skipUnchanged off (the 1.x default)', () => {
  it('renders every bound field on every message, unchanged or not', async () => {
    const writes: string[] = [];
    const runtime = createRuntime(writes);
    runtime.start();

    await update({ title: 'A', subtitle: 'B', priceLabel: 'C' });
    await update({ title: 'A', subtitle: 'B', priceLabel: 'C' });

    expect(writes).toHaveLength(6);
    expect(runtime.inspect().revisions.skippedUnchanged).toBe(0);
    runtime.destroy();
  });
});

describe('skipUnchanged on', () => {
  it('re-renders only the field a keystroke changed', async () => {
    const writes: string[] = [];
    const runtime = createRuntime(writes, { skipUnchanged: true });
    runtime.start();

    await update({ title: 'A', subtitle: 'B', priceLabel: 'C' });
    expect(writes).toEqual(['title=A', 'subtitle=B', 'priceLabel=C']);

    writes.length = 0;
    await update({ title: 'A2', subtitle: 'B', priceLabel: 'C' });
    expect(writes).toEqual(['title=A2']);
    expect(document.querySelector('[data-payload-field="subtitle"]')?.textContent).toBe('B');

    const snapshot = runtime.inspect();
    expect(snapshot.revisions.skippedUnchanged).toBe(2);
    expect(snapshot.scheduler.lastFlush?.appliedFields).toEqual(['title']);
    runtime.destroy();
  });

  it('compares rich-text values structurally, not by reference', async () => {
    // Payload allocates a new object graph per message. Reference equality
    // would re-render every rich-text field on every keystroke — the one place
    // the skip pays for itself, since each render costs a sanitizer pass.
    const writes: string[] = [];
    const runtime = createRuntime(writes, { skipUnchanged: true });
    runtime.start();
    // Not Lexical-shaped on purpose: a `root.children` value would upgrade the
    // binding to the rich-text renderer, which this fixture does not register.
    const body = (): unknown => ({ blocks: [{ type: 'text', text: 'same' }] });

    await update({ title: body() });
    await update({ title: body() });

    expect(writes).toHaveLength(1);
    runtime.destroy();
  });

  it('applies to an element the cache has not written before, even if the value is old', async () => {
    const writes: string[] = [];
    const runtime = createRuntime(writes, { skipUnchanged: true });
    runtime.start();
    await update({ title: 'A' });

    // The framework replaced the element (a soft navigation, a re-render).
    // The new node carries no history; the old value must land on it.
    const fresh = document.createElement('h1');
    fresh.setAttribute('data-payload-field', 'title');
    fresh.textContent = 'server-rendered';
    document.querySelector('[data-payload-field="title"]')?.replaceWith(fresh);
    // The mutation observer debounces before it rebuilds the cache; wait past
    // that window so the fresh element is bound before the next message.
    await vi.advanceTimersByTimeAsync(200);

    writes.length = 0;
    await update({ title: 'A' });

    expect(writes).toEqual(['title=A']);
    expect(fresh.textContent).toBe('A');
    runtime.destroy();
  });

  it('never skips a value it cannot give an identity', async () => {
    // A cyclic value has no identity (JSON refuses it). It must be applied on
    // every message rather than compared, because "no identity" can only ever
    // mean "changed" — never "equal".
    const writes: string[] = [];
    const runtime = createRuntime(writes, { skipUnchanged: true });
    runtime.start();
    const cyclic: Record<string, unknown> = { label: 'loop' };
    cyclic['self'] = cyclic;
    await update({ title: cyclic });
    await update({ title: cyclic });

    expect(writes).toHaveLength(2);
    runtime.destroy();
  });

  it('re-applies a dependent when its source field changed, unchanged value or not', async () => {
    const writes: string[] = [];
    const runtime = createRuntime(writes, {
      skipUnchanged: true,
      dependencies: { price: ['priceLabel'] },
    });
    runtime.start();

    await update({ price: 10, priceLabel: '10 €' });
    writes.length = 0;

    // priceLabel is byte-identical, but price moved: the label depends on it,
    // so a transform or renderer that derives the label must run again.
    await update({ price: 11, priceLabel: '10 €' });
    expect(writes).toEqual(['priceLabel=10 €']);

    writes.length = 0;
    // Neither changed: nothing is applied.
    await update({ price: 11, priceLabel: '10 €' });
    expect(writes).toEqual([]);
    runtime.destroy();
  });

  it('invalidates dependents on the first message after start', async () => {
    // There is no previous snapshot to compare against, so every source
    // counts as changed. The first message must always apply everything.
    const writes: string[] = [];
    const runtime = createRuntime(writes, {
      skipUnchanged: true,
      dependencies: { price: ['priceLabel'] },
    });
    runtime.start();
    await update({ price: 10, priceLabel: 'x' });
    expect(writes).toContain('priceLabel=x');
    runtime.destroy();
  });

  it('does not remember a write the renderer refused', async () => {
    // The built-in text renderer refuses an element with structured children
    // and reports that with the internal no-write sentinel, so the write is
    // not counted as applied. The identity must not be recorded for it, or
    // the next identical message would skip a binding that was never written.
    const runtime = new LivePreviewRuntime({
      renderers: { text: createTextRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      enableA11y: false,
      warn: () => {},
      skipUnchanged: true,
    });
    runtime.start();
    const title = document.querySelector('[data-payload-field="title"]')!;
    const wrapper = document.createElement('span');
    wrapper.textContent = 'styled';
    title.replaceChildren(wrapper);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await update({ title: 'A' });
    expect(title.firstElementChild?.textContent).toBe('styled');

    // The consumer removed the wrapper; the same value arrives again and must
    // land now, not be skipped as "already applied".
    title.replaceChildren();
    await update({ title: 'A' });
    expect(title.textContent).toBe('A');
    warn.mockRestore();
    runtime.destroy();
  });
});
