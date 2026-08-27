import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime, resolveFieldValue } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { buildBuiltinRenderers } from '@field-types/index';

// Provide a controllable IntersectionObserver in jsdom.
class IO implements IntersectionObserver {
  static latest: IO | undefined;
  readonly callback: IntersectionObserverCallback;
  readonly observed = new Set<Element>();
  readonly root: Element | Document | null = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[] = [];
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.rootMargin = options?.rootMargin ?? '';
    IO.latest = this;
  }
  observe(el: Element): void {
    this.observed.add(el);
  }
  unobserve(el: Element): void {
    this.observed.delete(el);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  setVisible(element: Element, visible: boolean): void {
    this.callback(
      [{ target: element, isIntersecting: visible } as IntersectionObserverEntry],
      this,
    );
  }
}

const TRUSTED = 'https://admin.example.com';
const OTHER_TRUSTED = 'https://admin-other.example.com';

function fireMessage(data: unknown, origin: string = TRUSTED): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
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

beforeEach(() => {
  vi.useFakeTimers();
  IO.latest = undefined;
  globalThis.IntersectionObserver = IO;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LivePreviewRuntime — happy path', () => {
  it('builds cache, processes a valid update, applies via renderer', async () => {
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('h1')?.textContent).toBe('new');
    expect(runtime.status).toBe('connected');
    expect(runtime.updateCount).toBe(1);
    runtime.destroy();
  });

  it('leases accessibility regions in each runtime root document', async () => {
    document.body.innerHTML = '<p data-payload-field="title">main</p>';
    const otherDocument = document.implementation.createHTMLDocument('other');
    otherDocument.body.innerHTML = '<p data-payload-field="title">other</p>';
    const base = {
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    } as const;
    const main = new LivePreviewRuntime({ ...base, root: document, emitter: new EventEmitter() });
    const other = new LivePreviewRuntime({
      ...base,
      root: otherDocument.body,
      emitter: new EventEmitter(),
    });
    main.start();
    other.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    const regionId = 'payload-live-preview-a11y';
    expect(document.getElementById(regionId)).not.toBeNull();
    expect(otherDocument.getElementById(regionId)).not.toBeNull();
    main.destroy();
    expect(document.getElementById(regionId)).toBeNull();
    expect(otherDocument.getElementById(regionId)).not.toBeNull();
    other.destroy();
  });

  it('releases the final accessibility lease without publishing a transient destroy announcement', async () => {
    document.body.innerHTML =
      '<div id="payload-live-preview-a11y"><span>Consumer baseline</span></div>' +
      '<p data-payload-field="title">initial</p>';
    const region = document.getElementById('payload-live-preview-a11y');
    const consumerChild = region?.firstChild;
    if (region === null || consumerChild === null) throw new Error('test live region missing');

    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    const observer = new MutationObserver(() => undefined);
    observer.observe(region, { characterData: true, subtree: true });
    runtime.destroy();
    const teardownMutations = observer.takeRecords();
    observer.disconnect();

    // Destroy releases the package-owned message node synchronously. It does
    // not briefly overwrite it with a disconnect message that cannot remain
    // mounted long enough to be a reliable screen-reader announcement.
    expect(teardownMutations).toHaveLength(0);
    expect(region.firstChild).toBe(consumerChild);
    expect(region.childNodes).toHaveLength(1);
    expect(region.textContent).toBe('Consumer baseline');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('emits init, connect, beforeUpdate, afterUpdate, elementUpdate', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const seen: string[] = [];
    const push = (name: string) => () => {
      seen.push(name);
    };
    emitter.on('init', push('init'));
    emitter.on('connect', push('connect'));
    emitter.on('beforeUpdate', push('beforeUpdate'));
    emitter.on('elementUpdate', push('elementUpdate'));
    emitter.on('afterUpdate', push('afterUpdate'));
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toContain('init');
    expect(seen).toContain('connect');
    expect(seen).toContain('beforeUpdate');
    expect(seen).toContain('elementUpdate');
    expect(seen).toContain('afterUpdate');
    runtime.destroy();
  });

  it('skips guarded update events and the pre-render DOM snapshot when nobody listens', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    const readSnapshot = vi.fn(() => 'old');
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: readSnapshot,
      set: () => undefined,
    });

    const render = vi.fn();
    const emitter = new EventEmitter();
    const emitWhile = vi.spyOn(emitter, 'emitWhile');
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();
    emitWhile.mockClear();

    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(emitWhile.mock.calls.map(([event]) => event)).not.toEqual(
      expect.arrayContaining(['beforeUpdate', 'elementUpdate', 'afterUpdate']),
    );
    runtime.destroy();
  });

  it('retains event data and one pre-render snapshot when update listeners exist', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    const readSnapshot = vi.fn(() => 'old snapshot');
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: readSnapshot,
      set: () => undefined,
    });

    const beforeUpdate = vi.fn();
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', beforeUpdate);
    emitter.on('elementUpdate', elementUpdate);
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render: vi.fn() } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(readSnapshot).toHaveBeenCalledOnce();
    expect(beforeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'new' } }, revision: 1 }),
    );
    expect(elementUpdate).toHaveBeenCalledWith({
      element,
      fieldName: 'title',
      previousValue: 'old snapshot',
      nextValue: 'new',
      revision: 1,
      receivedAt: expect.any(Number) as number,
      source: 'patch',
    });
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { fields: { title: 'new' } },
        updatedCount: 1,
        revision: 1,
      }),
    );
    runtime.destroy();
  });

  it('starts an elementUpdate listener registered by a renderer with the next write', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const elementUpdate = vi.fn();
    let registered = false;
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (target, value) => {
            if (!registered) {
              registered = true;
              emitter.on('elementUpdate', elementUpdate);
            }
            target.element.textContent = String(value);
          },
        },
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'first' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(elementUpdate).not.toHaveBeenCalled();

    fireMessage({ type: 'payload-live-preview', data: { title: 'second' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(elementUpdate).toHaveBeenCalledOnce();
    expect(elementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ previousValue: 'first', nextValue: 'second', revision: 2 }),
    );
    runtime.destroy();
  });

  it('discards an update superseded by a reentrant element snapshot getter', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('test binding missing');

    let superseded = false;
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: () => {
        if (!superseded) {
          superseded = true;
          fireMessage({ type: 'payload-live-preview', data: { title: 'newer' } });
        }
        return 'old';
      },
      set: () => undefined,
    });

    const rendered: unknown[] = [];
    const emitter = new EventEmitter();
    emitter.on('elementUpdate', vi.fn());
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: {
          name: 'text',
          render: (_target, value) => {
            rendered.push(value);
          },
        },
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'older' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(rendered).toEqual(['newer']);
    runtime.destroy();
  });

  it('keeps a reentrant update dispatched by connect as the active revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    emitter.on('connect', () => {
      fireMessage({ type: 'payload-live-preview', data: { title: 'newer' } });
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'older' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('newer');
    expect(runtime.updateCount).toBe(2);
    runtime.destroy();
  });

  it('allows beforeUpdate handlers to cancel the update', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', (e) => {
      e.cancel();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'new' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('old');
    runtime.destroy();
  });

  it('emits documentSave for payload-document-event messages', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const onDocumentSave = vi.fn();
    emitter.on('documentSave', onDocumentSave);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-document-event', action: 'updated' });
    await vi.advanceTimersByTimeAsync(50);
    expect(onDocumentSave).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('discards a slow older beforeUpdate completion after a newer update', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const releaseFirst = deferred<undefined>();
    emitter.on('beforeUpdate', async ({ data }) => {
      if (data.fields['title'] === 'A') await releaseFirst.promise;
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('B');

    releaseFirst.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('B');
    runtime.destroy();
  });

  it('stops obsolete beforeUpdate dispatch between sequential handlers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const releaseFirst = deferred<undefined>();
    const laterHandlers: string[] = [];
    const onceHandlers: string[] = [];
    emitter.on('beforeUpdate', async ({ data }) => {
      if (data.fields['title'] === 'A') await releaseFirst.promise;
    });
    emitter.on('beforeUpdate', ({ data }) => {
      laterHandlers.push(String(data.fields['title']));
    });
    emitter.once('beforeUpdate', ({ data }) => {
      onceHandlers.push(String(data.fields['title']));
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(laterHandlers).toEqual(['B']);
    expect(onceHandlers).toEqual(['B']);

    releaseFirst.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(laterHandlers).toEqual(['B']);
    expect(onceHandlers).toEqual(['B']);
    runtime.destroy();
  });

  it('stops an update when renderer resolution synchronously accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const elementRevisions: (number | undefined)[] = [];
    const afterRevisions: (number | undefined)[] = [];
    emitter.on('elementUpdate', ({ revision }) => {
      elementRevisions.push(revision);
    });
    emitter.on('afterUpdate', ({ revision }) => {
      afterRevisions.push(revision);
    });
    let reentered = false;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      resolveRenderer: () => {
        if (!reentered) {
          reentered = true;
          fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
        }
        return textRenderer();
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(elementRevisions).toEqual([2]);
    expect(afterRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('suppresses callbacks for a renderer that synchronously accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const elementRevisions: (number | undefined)[] = [];
    emitter.on('elementUpdate', ({ revision }) => {
      elementRevisions.push(revision);
    });
    const reentrantRenderer: FieldRenderer = {
      name: 'text',
      render(target, value) {
        target.element.textContent = String(value);
        if (value === 'A') {
          fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
        }
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: reentrantRenderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(elementRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('drops the rest of an active flush when its first binding accepts a newer revision', async () => {
    document.body.innerHTML =
      '<p data-payload-field="first">initial first</p>' +
      '<p data-payload-field="second">initial second</p>';
    const emitter = new EventEmitter();
    const renders: string[] = [];
    const elementRevisions: (number | undefined)[] = [];
    const afterRevisions: (number | undefined)[] = [];
    emitter.on('elementUpdate', ({ revision }) => {
      elementRevisions.push(revision);
    });
    emitter.on('afterUpdate', ({ revision }) => {
      afterRevisions.push(revision);
    });
    const renderer: FieldRenderer = {
      name: 'text',
      render(target, value) {
        renders.push(`${target.fieldName}:${String(value)}`);
        target.element.textContent = String(value);
        if (target.fieldName === 'first' && value === 'A first') {
          fireMessage({
            type: 'payload-live-preview',
            data: { first: 'B first', second: 'B second' },
          });
        }
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: renderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { first: 'A first', second: 'A second' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(renders).toEqual(['first:A first', 'first:B first', 'second:B second']);
    expect(document.querySelector('[data-payload-field="first"]')?.textContent).toBe('B first');
    expect(document.querySelector('[data-payload-field="second"]')?.textContent).toBe('B second');
    expect(elementRevisions).toEqual([2, 2]);
    expect(afterRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('drops the rest of an active flush when its first binding destroys the runtime', async () => {
    document.body.innerHTML =
      '<p data-payload-field="first">initial first</p>' +
      '<p data-payload-field="second">initial second</p>';
    const emitter = new EventEmitter();
    const renders: string[] = [];
    const elementUpdate = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('elementUpdate', elementUpdate);
    emitter.on('afterUpdate', afterUpdate);
    const renderer: FieldRenderer = {
      name: 'text',
      render(target, value) {
        renders.push(`${target.fieldName}:${String(value)}`);
        target.element.textContent = String(value);
        if (target.fieldName === 'first') runtime.destroy();
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: renderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { first: 'A first', second: 'A second' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(renders).toEqual(['first:A first']);
    expect(document.querySelector('[data-payload-field="second"]')?.textContent).toBe(
      'initial second',
    );
    expect(elementUpdate).not.toHaveBeenCalled();
    expect(afterUpdate).not.toHaveBeenCalled();
  });

  it('suppresses callbacks for an attribute write that synchronously accepts a newer revision', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title" data-payload-attribute="aria-label">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const elementRevisions: (number | undefined)[] = [];
    emitter.on('elementUpdate', ({ revision }) => {
      elementRevisions.push(revision);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    const setAttribute = element.setAttribute.bind(element);
    vi.spyOn(element, 'setAttribute').mockImplementation((name, value) => {
      setAttribute(name, value);
      if (name === 'aria-label' && value === 'A') {
        fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
      }
    });

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(element.getAttribute('aria-label')).toBe('B');
    expect(elementRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('does not report a renderer error after that renderer accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: string[] = [];
    emitter.on('error', ({ error }) => {
      errors.push(error.message);
    });
    const renderer: FieldRenderer = {
      name: 'text',
      render(target, value) {
        if (value === 'A') {
          fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
          throw new Error('obsolete renderer failure');
        }
        target.element.textContent = String(value);
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: renderer },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(errors).toEqual([]);
    runtime.destroy();
  });

  it('stops obsolete elementUpdate dispatch between sequential handlers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const laterRevisions: (number | undefined)[] = [];
    emitter.on('elementUpdate', async ({ revision }) => {
      if (revision === 1) {
        fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
      }
      await Promise.resolve();
    });
    emitter.on('elementUpdate', ({ revision }) => {
      laterRevisions.push(revision);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(laterRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('stops obsolete afterUpdate dispatch between sequential handlers', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const laterRevisions: (number | undefined)[] = [];
    emitter.on('afterUpdate', async ({ revision }) => {
      if (revision === 1) {
        fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
      }
      await Promise.resolve();
    });
    emitter.on('afterUpdate', ({ revision }) => {
      laterRevisions.push(revision);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(laterRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('does not revive an older buffered revision when the newer revision is cancelled', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    emitter.on('beforeUpdate', ({ data, cancel }) => {
      if (data.fields['title'] === 'B') cancel();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 50,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });

  it('does not let a saved cancel closure affect a newer accepted revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    let cancelOlder: (() => void) | undefined;
    const afterRevisions: (number | undefined)[] = [];
    emitter.on('beforeUpdate', ({ data, cancel }) => {
      if (data.fields['title'] === 'A') cancelOlder = cancel;
    });
    emitter.on('afterUpdate', ({ revision }) => {
      afterRevisions.push(revision);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 50,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'A' } });
    await flushMicrotasks();
    if (cancelOlder === undefined) throw new Error('older cancel closure was not captured');

    fireMessage({ type: 'payload-live-preview', data: { title: 'B' } });
    await flushMicrotasks();
    cancelOlder();
    await vi.advanceTimersByTimeAsync(100);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(afterRevisions).toEqual([2]);
    runtime.destroy();
  });

  it('invalidates a pending beforeUpdate continuation on destroy', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const release = deferred<undefined>();
    emitter.on('beforeUpdate', async () => release.promise);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await flushMicrotasks();
    runtime.destroy();

    release.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });

  it('emits afterUpdate with the actually applied data and revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const after: { data: { fields: Record<string, unknown> }; revision?: number }[] = [];
    emitter.on('afterUpdate', (event) => {
      after.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'applied', untouched: 42 } });
    await vi.advanceTimersByTimeAsync(50);

    expect(after).toHaveLength(1);
    expect(after[0]?.data.fields).toEqual({ title: 'applied', untouched: 42 });
    expect(after[0]?.revision).toBe(1);
    runtime.destroy();
  });

  it('associates a coalesced flush only with the newest revision and data', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const after: { data: { fields: Record<string, unknown> }; revision?: number }[] = [];
    emitter.on('afterUpdate', (event) => {
      after.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 20,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'A', marker: 'old' } });
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'B', marker: 'new' } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('B');
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      data: { fields: { title: 'B', marker: 'new' } },
      revision: 2,
    });
    runtime.destroy();
  });

  it('emits no success for deferred-only work and attributes a later replay correctly', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    expect(IO.latest?.observed.has(element)).toBe(true);

    fireMessage({ type: 'payload-live-preview', data: { title: 'A', marker: 1 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('initial');
    expect(afterUpdate).not.toHaveBeenCalled();

    fireMessage({ type: 'payload-live-preview', data: { title: 'B', marker: 2 } });
    await vi.advanceTimersByTimeAsync(50);
    expect(afterUpdate).not.toHaveBeenCalled();

    IO.latest?.setVisible(element, true);
    await flushMicrotasks();
    expect(element.textContent).toBe('B');
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { fields: { title: 'B', marker: 2 } },
        revision: 2,
        updatedCount: 1,
      }),
    );
    runtime.destroy();
  });

  it('reports visible and replayed writes as truthful batches of the same revision', async () => {
    document.body.innerHTML =
      '<p data-payload-field="title">old title</p><p data-payload-field="subtitle">old subtitle</p>';
    const [visible, deferredElement] = [...document.querySelectorAll('p')];
    if (visible === undefined || deferredElement === undefined) throw new Error('bindings missing');
    const emitter = new EventEmitter();
    const after: {
      readonly data: { readonly fields: Record<string, unknown> };
      readonly revision?: number;
      readonly updatedCount: number;
    }[] = [];
    emitter.on('afterUpdate', (event) => {
      after.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      visibilityGateThreshold: 0,
    });
    runtime.start();
    IO.latest?.setVisible(visible, true);

    const fields = { title: 'new title', subtitle: 'new subtitle', marker: 'same snapshot' };
    fireMessage({ type: 'payload-live-preview', data: fields });
    await vi.advanceTimersByTimeAsync(50);

    expect(visible.textContent).toBe('new title');
    expect(deferredElement.textContent).toBe('old subtitle');
    expect(after).toEqual([
      {
        data: { fields },
        revision: 1,
        updatedCount: 1,
        durationMs: 0,
        receivedAt: expect.any(Number) as number,
        source: 'patch',
      },
    ]);

    IO.latest?.setVisible(deferredElement, true);
    await flushMicrotasks();

    expect(deferredElement.textContent).toBe('new subtitle');
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ data: { fields }, revision: 1, updatedCount: 1 });
    runtime.destroy();
  });

  it('negotiates a data-less ready handshake without consuming an update revision', () => {
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter: new EventEmitter(),
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', ready: true, protocolVersion: 3 });

    expect(runtime.updateCount).toBe(0);
    expect(runtime.protocol).toMatchObject({ ours: 4, theirs: 3, negotiated: 3 });
    expect([...runtime.protocol.capabilities]).toEqual(['basic', 'schema-json', 'preview-token']);
    runtime.destroy();
  });

  it('uses the default ready broadcaster for a parent window', () => {
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
    const postMessage = vi.fn();
    const parent = { postMessage } as unknown as Window;
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      enableA11y: false,
    });

    try {
      runtime.start();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'payload-live-preview', ready: true, protocolVersion: 4 },
        TRUSTED,
      );
    } finally {
      runtime.destroy();
      if (parentDescriptor === undefined) Reflect.deleteProperty(window, 'parent');
      else Object.defineProperty(window, 'parent', parentDescriptor);
    }
  });

  it('uses the default ready broadcaster for a valid opener window', () => {
    const openerDescriptor = Object.getOwnPropertyDescriptor(window, 'opener');
    const postMessage = vi.fn();
    const opener = Object.create(Window.prototype) as Window;
    Object.defineProperty(opener, 'postMessage', { configurable: true, value: postMessage });
    Object.defineProperty(window, 'opener', { configurable: true, value: opener });
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      enableA11y: false,
    });

    try {
      runtime.start();

      expect(postMessage).toHaveBeenCalledWith(
        { type: 'payload-live-preview', ready: true, protocolVersion: 4 },
        TRUSTED,
      );
    } finally {
      runtime.destroy();
      if (openerDescriptor === undefined) Reflect.deleteProperty(window, 'opener');
      else Object.defineProperty(window, 'opener', openerDescriptor);
    }
  });

  it('does not resume a protocol-bearing revision superseded by reentrant diagnostics', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const log = (kind: unknown): void => {
      if (kind === 'protocol' && !reentered) {
        reentered = true;
        fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
      }
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      log,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      protocolVersion: 2,
      data: { title: 'obsolete' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(runtime.updateCount).toBe(2);
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });

  it('does not resume a connecting revision superseded by reentrant diagnostics', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const log = (kind: unknown): void => {
      if (kind === 'connection' && !reentered) {
        reentered = true;
        fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
      }
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      log,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'obsolete' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(runtime.updateCount).toBe(2);
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });

  it('stops obsolete field resolution after a data getter accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    let reentered = false;
    const fields = Object.defineProperty({}, 'title', {
      enumerable: true,
      get(): string {
        if (!reentered) {
          reentered = true;
          fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
        }
        return 'obsolete';
      },
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: fields });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(afterUpdate).toHaveBeenCalledOnce();
    expect(afterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fields: { title: 'current' } }, revision: 2 }),
    );
    runtime.destroy();
  });

  it('keeps schema, slug, and locale metadata attached to their applied revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const applied: unknown[] = [];
    emitter.on('afterUpdate', (event) => {
      applied.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();
    const schema = [{ name: 'title', type: 'text' }] as const;

    fireMessage({
      type: 'payload-live-preview',
      globalSlug: 'homepage',
      locale: 'de',
      fieldSchemaJSON: schema,
      data: { title: 'global' },
    });
    await vi.advanceTimersByTimeAsync(50);
    fireMessage({
      type: 'payload-live-preview',
      collectionSlug: 'posts',
      data: { title: 'collection' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(applied).toMatchObject([
      {
        data: { fields: { title: 'global' }, schema, globalSlug: 'homepage', locale: 'de' },
        revision: 1,
      },
      {
        data: { fields: { title: 'collection' }, schema, collectionSlug: 'posts', locale: 'de' },
        revision: 2,
      },
    ]);
    runtime.destroy();
  });

  it('keeps malformed Lexical-like objects on the ordinary text path', async () => {
    document.body.innerHTML =
      '<p data-payload-field="missingRoot">initial</p>' +
      '<p data-payload-field="nullRoot">initial</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { missingRoot: {}, nullRoot: { root: null } },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('[data-payload-field="missingRoot"]')?.textContent).toBe('{}');
    expect(document.querySelector('[data-payload-field="nullRoot"]')?.textContent).toBe(
      '{"root":null}',
    );
    runtime.destroy();
  });
});

describe('LivePreviewRuntime — error handling', () => {
  it('reports a rejected preview token without connecting or rendering', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    emitter.on('error', (event) => {
      errors.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      validateToken: () => false,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      previewToken: 'rejected',
      data: { title: 'must not render' },
    });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('token');
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(runtime.status).toBe('disconnected');
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });

  it('rejects asynchronous transforms and renders the original value', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    emitter.on('error', (event) => {
      errors.push(event);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      transformValue: () => Promise.resolve('async replacement'),
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'original' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(document.querySelector('p')?.textContent).toBe('original');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('transform');
    expect(errors[0]?.error).toBeInstanceOf(TypeError);
    runtime.destroy();
  });

  it('contains renderer-resolution failures and emits no successful batch', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors: { context: string; error: Error }[] = [];
    const afterUpdate = vi.fn();
    emitter.on('error', (event) => {
      errors.push(event);
    });
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      resolveRenderer: () => {
        throw new Error('resolution failed');
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'must not render' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.context).toBe('renderer');
    expect(errors[0]?.error).toBeInstanceOf(Error);
    expect(afterUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });

  it('suppresses a resolver failure after that resolver accepts a newer revision', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('error', errors);
    emitter.on('afterUpdate', afterUpdate);
    let firstResolution = true;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      resolveRenderer: () => {
        if (firstResolution) {
          firstResolution = false;
          fireMessage({ type: 'payload-live-preview', data: { title: 'current' } });
          throw new Error('obsolete resolver failure');
        }
        return textRenderer();
      },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'obsolete' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('current');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('treats a missing renderer as a no-write rather than a successful batch', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const errors = vi.fn();
    const afterUpdate = vi.fn();
    emitter.on('error', errors);
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'must not render' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(errors).not.toHaveBeenCalled();
    expect(afterUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });

  it('continues complete teardown when an owned observer disconnect throws', () => {
    class ThrowingDisconnectIO extends IO {
      override disconnect(): void {
        super.disconnect();
        throw new Error('disconnect failed');
      }
    }
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const destroy = vi.fn();
    emitter.on('destroy', destroy);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      log: vi.fn(),
      enableA11y: false,
    });

    globalThis.IntersectionObserver = ThrowingDisconnectIO;
    try {
      runtime.start();
      expect(runtime.cache.elementCount).toBe(1);

      expect(() => runtime.destroy()).not.toThrow();

      expect(runtime.cache.elementCount).toBe(0);
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      globalThis.IntersectionObserver = IO;
      runtime.destroy();
    }
  });

  it('passes the configured intersection margin to the owned observer', () => {
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      intersectionRootMargin: '37px 11px',
      enableA11y: false,
    });

    runtime.start();

    expect(IO.latest?.rootMargin).toBe('37px 11px');
    runtime.destroy();
  });

  it('captures native form and image values before elementUpdate callbacks', async () => {
    document.body.innerHTML =
      '<input data-payload-field="input" data-payload-type="text" value="input before">' +
      '<textarea data-payload-field="textarea" data-payload-type="text">textarea before</textarea>' +
      '<img data-payload-field="image" data-payload-type="text" src="/image-before.jpg" alt="">';
    const textarea = document.querySelector('textarea');
    if (textarea === null) throw new Error('textarea binding missing');
    textarea.value = 'textarea live value';
    const emitter = new EventEmitter();
    const previousValues: unknown[] = [];
    emitter.on('elementUpdate', (event) => {
      previousValues.push(event.previousValue);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render: () => undefined } },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      enableA11y: false,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { input: 'next', textarea: 'next', image: 'next' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(previousValues).toEqual([
      'input before',
      'textarea live value',
      'http://localhost:3000/image-before.jpg',
    ]);
    runtime.destroy();
  });

  it('surfaces renderer errors via the error event without aborting', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const errors: string[] = [];
    emitter.on('error', (e) => {
      errors.push(e.error.message);
    });
    const failingRenderer: FieldRenderer = {
      name: 'text',
      render() {
        throw new Error('renderer boom');
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text: failingRenderer },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'x' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(errors).toContain('renderer boom');
    runtime.destroy();
  });

  it('start is idempotent', () => {
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter,
    });
    expect(runtime.start()).toBe(true);
    expect(runtime.start()).toBe(false);
    runtime.destroy();
  });

  it('rolls back a failed observer startup so the same runtime can retry', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    class FailingIntersectionObserver extends IO {
      constructor(callback: IntersectionObserverCallback) {
        super(callback);
        throw new Error('intersection observer unavailable');
      }
    }
    globalThis.IntersectionObserver = FailingIntersectionObserver;
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(() => runtime.start()).toThrow('intersection observer unavailable');
      expect(runtime.cache.elementCount).toBe(0);

      globalThis.IntersectionObserver = originalIntersectionObserver;
      expect(runtime.start()).toBe(true);
      fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('p')?.textContent).toBe('after retry');
      expect(runtime.updateCount).toBe(1);
    } finally {
      globalThis.IntersectionObserver = originalIntersectionObserver;
      runtime.destroy();
    }
  });

  it('rolls back bus, observers, cache, and ready timers when initial sendReady throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const sendReady = vi.fn<(origins: readonly string[]) => void>().mockImplementationOnce(() => {
      throw new Error('ready transport failed');
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      sendReady,
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(() => runtime.start()).toThrow('ready transport failed');
      const failedObserver = IO.latest;
      expect(failedObserver?.observed.size).toBe(0);
      expect(runtime.cache.elementCount).toBe(0);

      fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
      await vi.advanceTimersByTimeAsync(2500);
      expect(document.querySelector('p')?.textContent).toBe('old');
      expect(sendReady).toHaveBeenCalledOnce();

      expect(runtime.start()).toBe(true);
      fireMessage({ type: 'payload-live-preview', data: { title: 'after retry' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('p')?.textContent).toBe('after retry');
    } finally {
      runtime.destroy();
    }
  });

  it('contains a later ready-retry failure and keeps the runtime operational', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const readyErrors: string[] = [];
    emitter.on('error', ({ error, context }) => {
      if (context === 'ready') readyErrors.push(error.message);
    });
    const sendReady = vi
      .fn<(origins: readonly string[]) => void>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error('retry transport failed');
      });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      debounceMs: 0,
      disableVisibilityGate: true,
    });

    try {
      expect(runtime.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(readyErrors).toEqual(['retry transport failed']);

      fireMessage({ type: 'payload-live-preview', data: { title: 'still active' } });
      await vi.advanceTimersByTimeAsync(50);
      expect(document.querySelector('p')?.textContent).toBe('still active');
    } finally {
      runtime.destroy();
    }
  });

  it('completes startup and remains update-capable when its diagnostic logger throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter: new EventEmitter(),
      debounceMs: 0,
      disableVisibilityGate: true,
      log: () => {
        throw new Error('consumer logger failed');
      },
    });

    try {
      expect(() => runtime.start()).not.toThrow();
      fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
      await vi.advanceTimersByTimeAsync(50);

      expect(document.querySelector('p')?.textContent).toBe('updated');
      expect(runtime.updateCount).toBe(1);
    } finally {
      runtime.destroy();
    }
  });

  it('observes rejected logger thenables without interrupting startup', async () => {
    const then = vi.fn(
      (_resolve: (value: unknown) => void, reject: (reason: unknown) => void): void => {
        reject(new Error('async logger failed'));
      },
    );
    const log = (): void => {
      return { then } as never;
    };
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      log,
    });

    try {
      expect(runtime.start()).toBe(true);
      await flushMicrotasks();

      expect(then).toHaveBeenCalled();
    } finally {
      runtime.destroy();
    }
  });

  it('destroy is idempotent', () => {
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: {},
      originMatcher: () => true,
      readyTargets: [],
      emitter,
    });
    runtime.start();
    runtime.destroy();
    expect(() => {
      runtime.destroy();
    }).not.toThrow();
  });

  it('does not schedule ready retries after sendReady destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn(() => {
      runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(2500);
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });

  it('finishes teardown when cacheRefresh destroys during startup', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const init = vi.fn();
    const sendReady = vi.fn();
    emitter.on('cacheRefresh', () => {
      runtime.destroy();
    });
    emitter.on('init', init);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(2500);

    expect(init).not.toHaveBeenCalled();
    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });

  it('does not continue startup when init destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    emitter.on('init', () => {
      runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      disableVisibilityGate: true,
    });

    runtime.start();
    await flushMicrotasks();
    fireMessage({ type: 'payload-live-preview', data: { title: 'zombie' } });
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).not.toHaveBeenCalled();
    expect(runtime.cache.elementCount).toBe(0);
    expect(runtime.updateCount).toBe(0);
    expect(document.querySelector('p')?.textContent).toBe('initial');
  });
});

describe('LivePreviewRuntime — disconnect / heartbeat', () => {
  it('reports a suspension as a disconnect, and only once it was connected', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const disconnect = vi.fn();
    emitter.on('disconnect', disconnect);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady: vi.fn(),
      disableVisibilityGate: true,
      enableA11y: false,
      log: vi.fn(),
    });

    runtime.start();
    // Nothing has connected yet: a suspension here has no connection to report,
    // and announcing one would tell a consumer it lost something it never had.
    expect(runtime.suspend()).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();

    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'connected' } });
    await flushMicrotasks();
    // The connection, not the DOM write: the write goes through the scheduler's
    // debounce, which has nothing to do with what this test is about.
    expect(runtime.status).toBe('connected');

    expect(runtime.suspend()).toBe(true);
    expect(disconnect).toHaveBeenCalledOnce();
    // `unload` rather than `destroy`: the instance is still usable, and a
    // consumer distinguishing the two must not be told the runtime is gone.
    expect(disconnect.mock.calls[0]?.[0]).toMatchObject({ reason: 'unload' });

    // Idempotent, and a second suspension has nothing left to announce.
    expect(runtime.suspend()).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('continues disconnect and ready recovery when the timeout hook throws', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const emitter = new EventEmitter();
    const disconnect = vi.fn();
    const sendReady = vi.fn();
    emitter.on('disconnect', disconnect);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      enableA11y: false,
      log: vi.fn(),
      onHeartbeatTimeout: () => {
        throw new Error('unlock failed');
      },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { title: 'connected' } });
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(25);

    expect(runtime.status).toBe('disconnected');
    expect(disconnect).toHaveBeenCalledWith(expect.objectContaining({ reason: 'timeout' }));
    expect(sendReady).toHaveBeenCalledTimes(2);
    runtime.destroy();
  });

  it('discards a token validation that settles after heartbeat expiry', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const verdict = deferred<boolean>();
    const validateToken = vi.fn(() => verdict.promise);
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      validateToken,
    });
    runtime.start();
    // A ready handshake starts the heartbeat but intentionally bypasses token
    // validation. The following data message remains pending across expiry.
    fireMessage({ type: 'payload-live-preview', ready: true });
    fireMessage({
      type: 'payload-live-preview',
      data: { x: 'zombie' },
      previewToken: 'pending',
    });
    expect(validateToken).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(25);
    verdict.resolve(true);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    expect(runtime.updateCount).toBe(0);
    expect(runtime.status).toBe('disconnected');
    runtime.destroy();
  });

  it('invalidates pending update work when a heartbeat lifecycle expires', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const release = deferred<undefined>();
    emitter.on('beforeUpdate', async () => release.promise);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) => origin === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 25,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'zombie' } });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(25);
    release.resolve(undefined);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('initial');
    runtime.destroy();
  });

  it('invokes onHeartbeatTimeout hook on timeout', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const onHeartbeatTimeout = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
      onHeartbeatTimeout,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(onHeartbeatTimeout).toHaveBeenCalled();
    runtime.destroy();
  });

  it('does not resend ready after the timeout hook destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
      onHeartbeatTimeout: () => {
        runtime.destroy();
      },
    });
    runtime.start();
    expect(sendReady).toHaveBeenCalledOnce();
    fireMessage({ type: 'payload-live-preview', data: { x: 'connected' } });

    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
  });

  it('does not resend ready after a timeout disconnect handler destroys the runtime', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    const sendReady = vi.fn();
    emitter.on('disconnect', ({ reason }) => {
      if (reason === 'timeout') runtime.destroy();
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      sendReady,
      heartbeatMs: 25,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(sendReady).toHaveBeenCalledOnce();
    fireMessage({ type: 'payload-live-preview', data: { x: 'connected' } });

    await vi.advanceTimersByTimeAsync(25);
    await vi.advanceTimersByTimeAsync(2500);

    expect(sendReady).toHaveBeenCalledOnce();
    expect(runtime.cache.elementCount).toBe(0);
  });

  it('marks disconnected and emits when heartbeat times out', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 50,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    vi.advanceTimersByTime(100);
    expect(disconnects).toContain('timeout');
    runtime.destroy();
  });

  it('unlocks before disconnect callbacks and preserves a reentrant reconnect lock', async () => {
    document.body.innerHTML = '<p data-payload-field="x">initial</p>';
    const emitter = new EventEmitter();
    let lockedOrigin: string | undefined;
    emitter.on('connect', ({ origin }) => {
      lockedOrigin = origin;
    });
    emitter.on('disconnect', ({ reason }) => {
      if (reason === 'timeout') {
        fireMessage({ type: 'payload-live-preview', data: { x: 'reconnected' } }, OTHER_TRUSTED);
      }
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (origin) =>
        lockedOrigin === undefined
          ? origin === TRUSTED || origin === OTHER_TRUSTED
          : origin === lockedOrigin,
      readyTargets: [TRUSTED, OTHER_TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 100,
      disableVisibilityGate: true,
      onHeartbeatTimeout: () => {
        lockedOrigin = undefined;
      },
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: 'first' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(lockedOrigin).toBe(TRUSTED);

    await vi.advanceTimersByTimeAsync(70);
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('reconnected');
    expect(lockedOrigin).toBe(OTHER_TRUSTED);

    fireMessage({ type: 'payload-live-preview', data: { x: 'must-not-apply' } }, TRUSTED);
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('p')?.textContent).toBe('reconnected');
    runtime.destroy();
  });

  it('destroy emits a "destroy" reason for in-flight connections', async () => {
    document.body.innerHTML = '<p data-payload-field="x">x</p>';
    const emitter = new EventEmitter();
    const disconnects: string[] = [];
    emitter.on('disconnect', (e) => {
      disconnects.push(e.reason);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({ type: 'payload-live-preview', data: { x: '1' } });
    await vi.advanceTimersByTimeAsync(50);
    runtime.destroy();
    expect(disconnects).toContain('destroy');
  });
});

describe('LivePreviewRuntime — cache refresh', () => {
  it('renders an element once after repeated programmatic cache upserts', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const render = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = String(value);
    });
    const runtime = new LivePreviewRuntime({
      renderers: { text: { name: 'text', render } },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    runtime.cache.add(element);
    runtime.cache.add(element);
    fireMessage({ type: 'payload-live-preview', data: { title: 'updated' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(render).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('updated');
    runtime.destroy();
  });

  it('rebuilds the cache when a new tracked element is added', async () => {
    document.body.innerHTML = '<p data-payload-field="title">old</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();
    const span = document.createElement('span');
    span.setAttribute('data-payload-field', 'subtitle');
    document.body.appendChild(span);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(150);
    fireMessage({ type: 'payload-live-preview', data: { subtitle: 'fresh' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('span')?.textContent).toBe('fresh');
    runtime.destroy();
  });

  it('refreshCache rebuilds explicitly', () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(runtime.cache.fieldCount).toBe(1);
    document.body.innerHTML = '<p data-payload-field="a">x</p><p data-payload-field="b">y</p>';
    runtime.refreshCache();
    expect(runtime.cache.fieldCount).toBe(2);
    runtime.destroy();
  });

  it('keeps refreshCache inert after destroy', () => {
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const cacheRefresh = vi.fn();
    emitter.on('cacheRefresh', cacheRefresh);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      disableVisibilityGate: true,
    });
    runtime.start();
    expect(cacheRefresh).toHaveBeenCalledOnce();
    runtime.destroy();
    document.body.innerHTML = '<p data-payload-field="replacement">replacement</p>';

    runtime.refreshCache();

    expect(runtime.cache.elementCount).toBe(0);
    expect(cacheRefresh).toHaveBeenCalledOnce();
  });

  it('retains an offscreen replay across refreshCache for the same field binding', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      visibilityGateThreshold: 0,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'replayed' } });
    await vi.advanceTimersByTimeAsync(50);
    expect(element.textContent).toBe('initial');
    expect(afterUpdate).not.toHaveBeenCalled();

    runtime.refreshCache();
    expect(IO.latest?.observed.has(element)).toBe(true);
    IO.latest?.setVisible(element, true);
    await flushMicrotasks();

    expect(element.textContent).toBe('replayed');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('retargets a retained debounced update to rebuilt cache metadata', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 50,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', data: { title: 'pending' } });
    await flushMicrotasks();
    element.setAttribute('data-payload-attribute', 'data-preview-value');
    runtime.refreshCache();
    await vi.advanceTimersByTimeAsync(100);

    expect(element.textContent).toBe('initial');
    expect(element.getAttribute('data-preview-value')).toBe('pending');
    expect(afterUpdate).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('retargets renderer and attribute metadata after observed binding mutations', async () => {
    document.body.innerHTML = '<p data-payload-field="title">initial</p>';
    const element = document.querySelector('p');
    if (element === null) throw new Error('binding missing');
    const textRender = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = `text:${String(value)}`;
    });
    const htmlRender = vi.fn((target: Parameters<FieldRenderer['render']>[0], value: unknown) => {
      target.element.textContent = `html:${String(value)}`;
    });
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: { name: 'text', render: textRender },
        html: { name: 'html', render: htmlRender },
      },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    element.setAttribute('data-payload-type', 'html');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', data: { title: 'typed' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(textRender).not.toHaveBeenCalled();
    expect(htmlRender).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('html:typed');

    element.setAttribute('data-payload-attribute', 'data-preview-value');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', data: { title: 'attributed' } });
    await vi.advanceTimersByTimeAsync(50);

    expect(htmlRender).toHaveBeenCalledOnce();
    expect(element.textContent).toBe('html:typed');
    expect(element.getAttribute('data-preview-value')).toBe('attributed');
    runtime.destroy();
  });

  it('retargets sibling href, src, and alt metadata after observed mutations', async () => {
    document.body.innerHTML =
      '<a data-payload-field="label" data-payload-href="firstHref">initial link</a>' +
      '<img data-payload-field="image" data-payload-src="firstSrc" data-payload-alt="firstAlt">';
    const link = document.querySelector('a');
    const image = document.querySelector('img');
    if (link === null || image === null) throw new Error('bindings missing');
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    link.setAttribute('data-payload-href', 'next.href');
    image.setAttribute('data-payload-src', 'next.src');
    image.setAttribute('data-payload-alt', 'next.alt');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        label: 'updated link',
        image: {
          url: 'https://media.example.com/original.jpg',
          alt: 'media-object alt',
        },
        firstHref: 'https://stale.example.com',
        firstSrc: 'https://stale.example.com/stale.jpg',
        firstAlt: 'stale alt',
        next: {
          href: 'https://example.com/next',
          src: 'https://cdn.example.com/next.jpg',
          alt: 'next alt',
        },
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(link.href).toBe('https://example.com/next');
    expect(image.src).toBe('https://cdn.example.com/next.jpg');
    expect(image.alt).toBe('next alt');
    runtime.destroy();
  });

  it('retargets array template and separator metadata after observed mutations', async () => {
    document.body.innerHTML =
      '<div id="template" data-payload-field="items" data-payload-array ' +
      'data-payload-array-template="<i>{{value}}</i>"></div>' +
      '<div id="separator" data-payload-field="tags" data-payload-array ' +
      'data-payload-array-separator=", "></div>';
    const template = document.querySelector('#template');
    const separator = document.querySelector('#separator');
    if (template === null || separator === null) throw new Error('bindings missing');
    const runtime = new LivePreviewRuntime({
      renderers: buildBuiltinRenderers(),
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    template.setAttribute('data-payload-array-template', '<strong>{{value}}</strong>');
    separator.setAttribute('data-payload-array-separator', ' / ');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: { items: ['one', 'two'], tags: ['alpha', 'beta'] },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(template.innerHTML).toBe('<strong>one</strong><strong>two</strong>');
    expect(separator.textContent).toBe('alpha / beta');
    runtime.destroy();
  });

  it('retargets marker- and input-inferred types after observed mutations', async () => {
    document.body.innerHTML =
      '<div data-payload-field="body">initial body</div>' +
      '<input data-payload-field="amount" type="text" value="initial amount">';
    const body = document.querySelector('div');
    const amount = document.querySelector('input');
    if (body === null || amount === null) throw new Error('bindings missing');
    const textRender = vi.fn();
    const richTextRender = vi.fn();
    const numberRender = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: {
        text: { name: 'text', render: textRender },
        richText: { name: 'richText', render: richTextRender },
        number: { name: 'number', render: numberRender },
      },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    body.setAttribute('data-payload-richtext', '');
    amount.setAttribute('type', 'number');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({
      type: 'payload-live-preview',
      data: { body: 'updated body', amount: 42 },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(textRender).not.toHaveBeenCalled();
    expect(richTextRender).toHaveBeenCalledOnce();
    expect(numberRender).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('uses and retargets an element-local locale after an observed mutation', async () => {
    document.body.innerHTML =
      '<span data-payload-field="amount" data-payload-locale="de-DE">initial</span>';
    const element = document.querySelector('span');
    if (element === null) throw new Error('binding missing');
    const locales: (string | undefined)[] = [];
    const numberRenderer: FieldRenderer = {
      name: 'number',
      render(target, value, context) {
        locales.push(context.locale);
        target.element.textContent = String(value);
      },
    };
    element.setAttribute('data-payload-type', 'number');
    const runtime = new LivePreviewRuntime({
      renderers: { number: numberRenderer },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 1 } });
    await vi.advanceTimersByTimeAsync(50);
    element.setAttribute('data-payload-locale', 'fr-FR');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(100);
    fireMessage({ type: 'payload-live-preview', locale: 'en-US', data: { amount: 2 } });
    await vi.advanceTimersByTimeAsync(50);

    expect(locales).toEqual(['de-DE', 'fr-FR']);
    runtime.destroy();
  });

  it('falls back to the message locale when the element locale override is empty', async () => {
    document.body.innerHTML =
      '<span data-payload-field="title" data-payload-locale="">initial</span>';
    const element = document.querySelector('span');
    if (element === null) throw new Error('binding missing');
    const locales: (string | undefined)[] = [];
    const text: FieldRenderer = {
      name: 'text',
      render(target, value, context) {
        locales.push(context.locale);
        target.element.textContent = String(value);
      },
    };
    const runtime = new LivePreviewRuntime({
      renderers: { text },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      locale: 'de',
      data: { title_de: 'Deutsch' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(element.textContent).toBe('Deutsch');
    expect(locales).toEqual(['de']);
    runtime.destroy();
  });

  it('resolves locale-suffixed values independently for each binding', async () => {
    document.body.innerHTML =
      '<span id="default" data-payload-field="title">initial</span>' +
      '<span id="de" data-payload-field="title" data-payload-locale="de">initial</span>' +
      '<span id="fr" data-payload-field="title" data-payload-locale="fr">initial</span>';
    const defaultElement = document.querySelector('#default');
    const de = document.querySelector('#de');
    const fr = document.querySelector('#fr');
    if (defaultElement === null || de === null || fr === null) throw new Error('bindings missing');
    const warn = vi.fn();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter: new EventEmitter(),
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      warn,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      locale: 'en',
      data: { title: 'English', title_de: 'Deutsch', title_fr: 'Français' },
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(defaultElement.textContent).toBe('English');
    expect(de.textContent).toBe('Deutsch');
    expect(fr.textContent).toBe('Français');
    expect(warn).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('discards a buffered value when an observed element locale changes', async () => {
    document.body.innerHTML =
      '<span data-payload-field="title" data-payload-locale="de">initial</span>';
    const element = document.querySelector('span');
    if (element === null) throw new Error('binding missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 200,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { title_de: 'Deutsch', title_fr: 'Français' },
    });
    await flushMicrotasks();
    element.setAttribute('data-payload-locale', 'fr');
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(300);

    expect(element.textContent).toBe('initial');
    expect(afterUpdate).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('discards pending work when refreshCache removes or rebinds its element', async () => {
    document.body.innerHTML =
      '<p data-payload-field="removed">initial-removed</p>' +
      '<p data-payload-field="renamed">initial-renamed</p>';
    const removed = document.querySelector('[data-payload-field="removed"]');
    const renamed = document.querySelector('[data-payload-field="renamed"]');
    if (removed === null || renamed === null) throw new Error('bindings missing');
    const emitter = new EventEmitter();
    const afterUpdate = vi.fn();
    emitter.on('afterUpdate', afterUpdate);
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: () => true,
      readyTargets: [],
      emitter,
      debounceMs: 50,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
    });
    runtime.start();

    fireMessage({
      type: 'payload-live-preview',
      data: { removed: 'stale-removed', renamed: 'stale-renamed' },
    });
    await flushMicrotasks();
    removed.remove();
    renamed.setAttribute('data-payload-field', 'replacement');
    runtime.refreshCache();
    await vi.advanceTimersByTimeAsync(100);

    expect(removed.textContent).toBe('initial-removed');
    expect(renamed.textContent).toBe('initial-renamed');
    expect(afterUpdate).not.toHaveBeenCalled();
    runtime.destroy();
  });
});

describe('resolveFieldValue', () => {
  it('reads top-level fields', () => {
    expect(resolveFieldValue({ a: 1 }, 'a', undefined)).toBe(1);
  });

  it('reads nested dotted paths', () => {
    expect(resolveFieldValue({ hero: { title: 'x' } }, 'hero.title', undefined)).toBe('x');
  });

  it('falls back to locale-suffixed key when present', () => {
    expect(resolveFieldValue({ title_de: 'DE' }, 'title', 'de')).toBe('DE');
  });

  it('prefers a locale-suffixed key for an explicit binding override', () => {
    expect(resolveFieldValue({ title: 'EN', title_de: 'DE' }, 'title', 'de', true)).toBe('DE');
  });

  it('falls back to a locale-suffixed top-level key for a dotted path', () => {
    expect(resolveFieldValue({ 'hero.alt_de': 'Deutsch' }, 'hero.alt', 'de')).toBe('Deutsch');
  });

  it('blocks prototype pollution keys', () => {
    expect(resolveFieldValue({}, '__proto__', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'constructor', undefined)).toBeUndefined();
    expect(resolveFieldValue({}, 'a.__proto__.x', undefined)).toBeUndefined();
  });

  it('returns undefined for missing fields', () => {
    expect(resolveFieldValue({}, 'missing', undefined)).toBeUndefined();
  });

  it('returns undefined when intermediate path segment is not an object', () => {
    expect(resolveFieldValue({ a: 'x' }, 'a.b', undefined)).toBeUndefined();
  });
});

describe('LivePreviewRuntime — orphan-field diagnostic', () => {
  function setupRuntime(html: string, warn: (...args: unknown[]) => void): LivePreviewRuntime {
    document.body.innerHTML = html;
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      heartbeatMs: 10 * 60_000,
      disableVisibilityGate: true,
      warn,
    });
    runtime.start();
    return runtime;
  }

  function joinLog(log: ReturnType<typeof vi.fn>): string {
    return log.mock.calls.map((c) => c.map((a) => String(a)).join(' ')).join('\n');
  }

  it('warns when an update arrives for a field with no [data-payload-field] anchor', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'new', shortDescription: 'no anchor here' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).toMatch(
      /update arrived for field "shortDescription".*no .* element exists/s,
    );
    runtime.destroy();
  });

  it('does not warn when the field has a binding', async () => {
    const log = vi.fn();
    const runtime = setupRuntime(
      '<h1 data-payload-field="title">old</h1><p data-payload-field="shortDescription">old</p>',
      log,
    );
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', shortDescription: 'y' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('dedupes — the same orphan field only warns once', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', log);
    for (let i = 0; i < 5; i += 1) {
      fireMessage({
        type: 'payload-live-preview',
        data: { title: `t${String(i)}`, missing: `m${String(i)}` },
      });
      await vi.advanceTimersByTimeAsync(50);
    }
    const matches = joinLog(log).match(/update arrived for field "missing"/g) ?? [];
    expect(matches).toHaveLength(1);
    runtime.destroy();
  });

  it('skips system fields (id, createdAt, _status, …)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        id: 42,
        _id: 'abc',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        createdBy: 'admin-1',
        updatedBy: 'admin-2',
        _status: 'draft',
        globalType: 'homepage',
        collection: 'posts',
        locale: 'de',
        localized: true,
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('skips non-scalar values (Lexical objects, relationship arrays)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        description: { root: { children: [] } }, // Lexical
        relatedItems: [{ id: 1 }, { id: 2 }],
        media: null,
      },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('diagnoses every supported scalar kind while ignoring nullish values', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<h1 data-payload-field="title">x</h1>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: {
        title: 'new',
        textOrphan: 'text',
        numberOrphan: 42,
        booleanOrphan: false,
        bigintOrphan: 42n,
        nullValue: null,
        undefinedValue: undefined,
      },
    });
    await vi.advanceTimersByTimeAsync(50);

    const output = joinLog(log);
    for (const field of ['textOrphan', 'numberOrphan', 'booleanOrphan', 'bigintOrphan']) {
      expect(output).toContain(`field "${field}"`);
    }
    expect(output).not.toContain('nullValue');
    expect(output).not.toContain('undefinedValue');
    runtime.destroy();
  });

  it('treats locale-suffixed names as the base name when matching bindings', async () => {
    const warn = vi.fn();
    document.body.innerHTML = '<p data-payload-field="title">x</p>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      warn,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      locale: 'de',
      data: { title_de: 'localised value' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(warn)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('does not warn when the cache is empty (page has no bindings yet)', async () => {
    const log = vi.fn();
    const runtime = setupRuntime('<div>no bindings here</div>', log);
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', shortDescription: 'y' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(log)).not.toMatch(/update arrived for field/);
    runtime.destroy();
  });

  it('fires through the warn channel even when debug-log is the noop default', async () => {
    const warn = vi.fn();
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
      // no `log` — production default is noop; diagnostic should still fire.
      warn,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', someOrphan: 'value' },
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(joinLog(warn)).toMatch(/update arrived for field "someOrphan"/);
    runtime.destroy();
  });

  it('keeps later updates functional when the warning callback throws', async () => {
    let warningCalls = 0;
    const runtime = setupRuntime('<h1 data-payload-field="title">old</h1>', () => {
      warningCalls += 1;
      throw new Error('consumer warning callback failed');
    });

    try {
      fireMessage({
        type: 'payload-live-preview',
        data: { title: 'first', firstOrphan: 'missing' },
      });
      await vi.advanceTimersByTimeAsync(50);
      fireMessage({
        type: 'payload-live-preview',
        data: { title: 'second', secondOrphan: 'missing' },
      });
      await vi.advanceTimersByTimeAsync(50);

      expect(warningCalls).toBe(2);
      expect(document.querySelector('h1')?.textContent).toBe('second');
      expect(runtime.updateCount).toBe(2);
    } finally {
      runtime.destroy();
    }
  });

  it('defaults the warn channel to console.warn when no override is given', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
    const emitter = new EventEmitter();
    const runtime = new LivePreviewRuntime({
      renderers: { text: textRenderer() },
      originMatcher: (o) => o === TRUSTED,
      readyTargets: [TRUSTED],
      emitter,
      debounceMs: 0,
      disableVisibilityGate: true,
    });
    runtime.start();
    fireMessage({
      type: 'payload-live-preview',
      data: { title: 'x', orphanField: 'no anchor' },
    });
    await vi.advanceTimersByTimeAsync(50);
    const all = consoleWarnSpy.mock.calls
      .flatMap((c) => c)
      .map((a) => String(a))
      .join(' ');
    expect(all).toMatch(/update arrived for field "orphanField"/);
    consoleWarnSpy.mockRestore();
    runtime.destroy();
  });
});
