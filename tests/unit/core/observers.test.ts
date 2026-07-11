import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObserverManager } from '@core/observers';

// jsdom does not implement IntersectionObserver — install a controllable stub.
interface MockIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed: Set<Element>;
  trigger(element: Element, isIntersecting: boolean): void;
}

const mockObservers: MockIntersectionObserver[] = [];

function makeIntersectionObserverStub(): typeof IntersectionObserver {
  return class implements IntersectionObserver {
    readonly callback: IntersectionObserverCallback;
    readonly observed = new Set<Element>();
    readonly root: Element | Document | null = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];

    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      const observed = this.observed;
      const trigger = (el: Element, isIntersecting: boolean): void => {
        const entry: IntersectionObserverEntry = {
          target: el,
          isIntersecting,
          intersectionRatio: isIntersecting ? 1 : 0,
          time: performance.now(),
          boundingClientRect: el.getBoundingClientRect(),
          intersectionRect: el.getBoundingClientRect(),
          rootBounds: null,
        };
        cb([entry], {} as unknown as IntersectionObserver);
      };
      mockObservers.push({ callback: cb, observed, trigger });
    }
    observe(target: Element): void {
      this.observed.add(target);
    }
    unobserve(target: Element): void {
      this.observed.delete(target);
    }
    disconnect(): void {
      this.observed.clear();
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  mockObservers.length = 0;
  globalThis.IntersectionObserver = makeIntersectionObserverStub();
});

afterEach(() => {
  vi.useRealTimers();
});

function getLatestStub(): MockIntersectionObserver {
  const last = mockObservers.at(-1);
  if (!last) throw new Error('no intersection observer was created');
  return last;
}

// MutationObserver dispatches via microtask, so tests must flush them
// after every mutation before advancing fake timers for the debounce.
const flushMutations = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('ObserverManager — mutations', () => {
  it('invokes onStructuralChange after the debounce when a tracked element is added', async () => {
    const root = document.body;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 50 },
    );
    observer.start(root);

    const tracked = document.createElement('span');
    tracked.setAttribute('data-payload-field', 'x');
    root.appendChild(tracked);
    await flushMutations();

    expect(onStructuralChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onStructuralChange).toHaveBeenCalledOnce();

    observer.stop();
  });

  it('does not fire when mutations do not affect tracked elements', async () => {
    const root = document.body;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager({
      onStructuralChange,
      onVisibilityChange: () => {},
    });
    observer.start(root);
    root.appendChild(document.createElement('p'));
    await flushMutations();
    vi.advanceTimersByTime(200);
    expect(onStructuralChange).not.toHaveBeenCalled();
    observer.stop();
  });

  it('fires for attribute changes on the field attribute', async () => {
    const root = document.body;
    const tracked = document.createElement('p');
    tracked.setAttribute('data-payload-field', 'a');
    root.appendChild(tracked);
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(root);
    tracked.setAttribute('data-payload-field', 'b');
    await flushMutations();
    vi.advanceTimersByTime(10);
    expect(onStructuralChange).toHaveBeenCalledOnce();
    observer.stop();
  });

  it('fires for the removal of a tracked element', async () => {
    const root = document.body;
    const tracked = document.createElement('p');
    tracked.setAttribute('data-payload-field', 'a');
    root.appendChild(tracked);
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(root);
    tracked.remove();
    await flushMutations();
    vi.advanceTimersByTime(10);
    expect(onStructuralChange).toHaveBeenCalledOnce();
    observer.stop();
  });

  it('coalesces a burst of mutations into a single callback', async () => {
    const root = document.body;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 50 },
    );
    observer.start(root);
    for (let i = 0; i < 10; i += 1) {
      const span = document.createElement('span');
      span.setAttribute('data-payload-field', `f${String(i)}`);
      root.appendChild(span);
    }
    await flushMutations();
    vi.advanceTimersByTime(50);
    expect(onStructuralChange).toHaveBeenCalledOnce();
    observer.stop();
  });

  it('detects added nodes that contain a tracked descendant', async () => {
    const root = document.body;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(root);
    const wrapper = document.createElement('section');
    wrapper.innerHTML = '<p data-payload-field="nested">x</p>';
    root.appendChild(wrapper);
    await flushMutations();
    vi.advanceTimersByTime(10);
    expect(onStructuralChange).toHaveBeenCalledOnce();
    observer.stop();
  });
});

describe('ObserverManager — visibility', () => {
  it('reports visibility changes through the callback', () => {
    const onVisibilityChange = vi.fn();
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange,
    });
    observer.start(document.body);
    const el = document.createElement('p');
    document.body.appendChild(el);
    observer.observeElement(el);
    const stub = getLatestStub();
    expect(stub.observed.has(el)).toBe(true);

    stub.trigger(el, true);
    expect(observer.isVisible(el)).toBe(true);
    expect(onVisibilityChange).toHaveBeenCalledWith(el, true);

    stub.trigger(el, false);
    expect(observer.isVisible(el)).toBe(false);
    expect(onVisibilityChange).toHaveBeenCalledWith(el, false);

    observer.stop();
  });

  it('does not double-fire for repeat states', () => {
    const onVisibilityChange = vi.fn();
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange,
    });
    observer.start(document.body);
    const el = document.createElement('p');
    document.body.appendChild(el);
    observer.observeElement(el);
    const stub = getLatestStub();
    stub.trigger(el, true);
    stub.trigger(el, true);
    expect(onVisibilityChange).toHaveBeenCalledOnce();
  });

  it('unobserveElement clears stub state', () => {
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });
    observer.start(document.body);
    const el = document.createElement('p');
    observer.observeElement(el);
    observer.markVisible(el, true);
    observer.unobserveElement(el);
    expect(observer.isVisible(el)).toBe(false);
  });

  it('markVisible toggles state', () => {
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });
    observer.start(document.body);
    const el = document.createElement('p');
    observer.markVisible(el, true);
    expect(observer.isVisible(el)).toBe(true);
    observer.markVisible(el, false);
    expect(observer.isVisible(el)).toBe(false);
  });
});

describe('ObserverManager — lifecycle', () => {
  it('stop is idempotent', () => {
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });
    observer.start(document.body);
    expect(() => {
      observer.stop();
      observer.stop();
    }).not.toThrow();
  });

  it('observeElement before start is a no-op', () => {
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });
    expect(() => {
      observer.observeElement(document.createElement('p'));
    }).not.toThrow();
  });

  it('cancels a pending debounce timer when stopped early', () => {
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 100 },
    );
    observer.start(document.body);
    const tracked = document.createElement('p');
    tracked.setAttribute('data-payload-field', 'x');
    document.body.appendChild(tracked);
    observer.stop();
    vi.advanceTimersByTime(200);
    expect(onStructuralChange).not.toHaveBeenCalled();
  });
});
