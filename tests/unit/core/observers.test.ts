import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BINDING_ATTRIBUTES } from '@core/cache';
import { ObserverManager } from '@core/observers';

// jsdom does not implement IntersectionObserver — install a controllable stub.
interface MockIntersectionObserver {
  readonly callback: IntersectionObserverCallback;
  readonly observed: Set<Element>;
  trigger(element: Element, isIntersecting: boolean): void;
  triggerBatch(entries: readonly [element: Element, isIntersecting: boolean][]): void;
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
      const makeEntry = (el: Element, isIntersecting: boolean): IntersectionObserverEntry => ({
        target: el,
        isIntersecting,
        intersectionRatio: isIntersecting ? 1 : 0,
        time: performance.now(),
        boundingClientRect: el.getBoundingClientRect(),
        intersectionRect: el.getBoundingClientRect(),
        rootBounds: null,
      });
      const triggerBatch = (entries: readonly [Element, boolean][]): void => {
        cb(
          entries.map(([element, isIntersecting]) => makeEntry(element, isIntersecting)),
          {} as unknown as IntersectionObserver,
        );
      };
      const trigger = (el: Element, isIntersecting: boolean): void => {
        triggerBatch([[el, isIntersecting]]);
      };
      mockObservers.push({ callback: cb, observed, trigger, triggerBatch });
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

const EXPECTED_BINDING_ATTRIBUTES = [
  'data-payload-field',
  'data-payload-type',
  'data-payload-attribute',
  'data-payload-href',
  'data-payload-src',
  'data-payload-alt',
  'data-payload-array-template',
  'data-payload-array-separator',
  'data-payload-locale',
  'data-payload-richtext',
  'data-payload-html',
  'data-payload-array',
  'data-payload-structural',
  'type',
] as const;

describe('ObserverManager — mutations', () => {
  it('keeps the complete cached-binding attribute contract in one list', () => {
    expect(BINDING_ATTRIBUTES).toEqual(EXPECTED_BINDING_ATTRIBUTES);
  });

  it.each(EXPECTED_BINDING_ATTRIBUTES)(
    'fires for a change to binding attribute %s',
    async (attribute) => {
      const root = document.body;
      const tracked = document.createElement('p');
      tracked.setAttribute('data-payload-field', 'title');
      root.appendChild(tracked);
      const onStructuralChange = vi.fn();
      const observer = new ObserverManager(
        { onStructuralChange, onVisibilityChange: () => {} },
        { mutationDebounceMs: 10 },
      );
      observer.start(root);

      tracked.setAttribute(attribute, 'changed');
      await flushMutations();
      vi.advanceTimersByTime(10);

      expect(onStructuralChange).toHaveBeenCalledOnce();
      observer.stop();
    },
  );

  it('ignores a native type change on an unbound element', async () => {
    const root = document.body;
    const unbound = document.createElement('input');
    root.appendChild(unbound);
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(root);

    unbound.setAttribute('type', 'number');
    await flushMutations();
    vi.advanceTimersByTime(10);

    expect(onStructuralChange).not.toHaveBeenCalled();
    observer.stop();
  });

  it('detects binding metadata changes in a different DOM realm', async () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const iframeDocument = iframe.contentDocument;
    if (iframeDocument === null) throw new Error('iframe document missing');
    const tracked = iframeDocument.createElement('p');
    tracked.setAttribute('data-payload-field', 'title');
    iframeDocument.body.appendChild(tracked);
    expect(tracked instanceof Element).toBe(false);
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(iframeDocument.body);

    tracked.setAttribute('data-payload-locale', 'de');
    await flushMutations();
    vi.advanceTimersByTime(10);

    expect(onStructuralChange).toHaveBeenCalledOnce();
    observer.stop();
    iframe.remove();
  });

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

  it('does not fire or throw when child mutations contain non-elements or unbound elements', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    let mutationCallback: MutationCallback | undefined;
    class CapturingMutationObserver implements MutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }
      disconnect(): void {}
      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    globalThis.MutationObserver = CapturingMutationObserver;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager({
      onStructuralChange,
      onVisibilityChange: () => {},
    });
    try {
      observer.start(document.body);
      if (mutationCallback === undefined) throw new Error('mutation callback was not captured');
      const irrelevant = [document.createTextNode('text'), document.createElement('p')];
      let callbackError: unknown;
      try {
        mutationCallback(
          [
            {
              type: 'childList',
              addedNodes: irrelevant,
              removedNodes: [],
            } as unknown as MutationRecord,
          ],
          {} as MutationObserver,
        );
      } catch (error) {
        callbackError = error;
      }

      expect(callbackError).toBeUndefined();
      vi.advanceTimersByTime(200);
      expect(onStructuralChange).not.toHaveBeenCalled();
    } finally {
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
    }
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

  it('keeps an ineffectively cancelled debounce callback stale after stop', async () => {
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(document.body);
    const tracked = document.createElement('p');
    tracked.setAttribute('data-payload-field', 'stale');
    document.body.appendChild(tracked);
    await flushMutations();
    const ineffectiveClearTimeout = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);

    try {
      observer.stop();
      vi.advanceTimersByTime(10);
      expect(onStructuralChange).not.toHaveBeenCalled();
    } finally {
      ineffectiveClearTimeout.mockRestore();
      tracked.remove();
    }
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

  it('invalidates the rest of an intersection batch when a callback stops the manager', () => {
    const seen: string[] = [];
    const first = document.createElement('p');
    const second = document.createElement('p');
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: (element, visible) => {
        seen.push(`${element === first ? 'first' : 'second'}:${String(visible)}`);
        observer.stop();
      },
    });
    observer.start(document.body);

    getLatestStub().triggerBatch([
      [first, true],
      [second, true],
    ]);

    expect(seen).toEqual(['first:true']);
    expect(observer.isVisible(first)).toBe(false);
    expect(observer.isVisible(second)).toBe(false);
  });

  it('ignores deliveries from an intersection observer replaced by restart', () => {
    const onVisibilityChange = vi.fn();
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange,
    });
    observer.start(document.body);
    const stale = getLatestStub();
    observer.start(document.documentElement);
    const current = getLatestStub();
    const element = document.createElement('p');

    stale.trigger(element, true);
    expect(onVisibilityChange).not.toHaveBeenCalled();
    expect(observer.isVisible(element)).toBe(false);

    current.trigger(element, true);
    expect(onVisibilityChange).toHaveBeenCalledExactlyOnceWith(element, true);
    expect(observer.isVisible(element)).toBe(true);
    observer.stop();
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
  it('rolls back a candidate mutation observer when intersection construction fails', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const disconnect = vi.fn();
    const observe = vi.fn();

    class CandidateMutationObserver implements MutationObserver {
      readonly disconnect = disconnect;
      readonly observe = observe;

      takeRecords(): MutationRecord[] {
        return [];
      }
    }

    class FailingIntersectionObserver {
      readonly root = null;

      constructor(_callback: IntersectionObserverCallback) {
        throw new Error('intersection construction failed');
      }
    }

    globalThis.MutationObserver = CandidateMutationObserver;
    globalThis.IntersectionObserver =
      FailingIntersectionObserver as unknown as typeof IntersectionObserver;
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });

    try {
      expect(() => observer.start(document.body)).toThrow('intersection construction failed');
      expect(disconnect).toHaveBeenCalledOnce();
      expect(observe).not.toHaveBeenCalled();
    } finally {
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('disconnects every active observer before a restart', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const mutationDisconnects: ReturnType<typeof vi.fn>[] = [];
    const intersectionDisconnects: ReturnType<typeof vi.fn>[] = [];

    class RestartMutationObserver implements MutationObserver {
      readonly disconnect = vi.fn();

      constructor(_callback: MutationCallback) {
        mutationDisconnects.push(this.disconnect);
      }

      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }

    class RestartIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      readonly disconnect = vi.fn();

      constructor(_callback: IntersectionObserverCallback) {
        intersectionDisconnects.push(this.disconnect);
      }

      observe(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    globalThis.MutationObserver = RestartMutationObserver;
    globalThis.IntersectionObserver = RestartIntersectionObserver;
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });

    try {
      observer.start(document.body);
      observer.markVisible(document.createElement('p'), true);
      observer.start(document.documentElement);

      expect(mutationDisconnects).toHaveLength(2);
      expect(intersectionDisconnects).toHaveLength(2);
      expect(mutationDisconnects[0]).toHaveBeenCalledOnce();
      expect(intersectionDisconnects[0]).toHaveBeenCalledOnce();

      observer.stop();
      expect(mutationDisconnects[1]).toHaveBeenCalledOnce();
      expect(intersectionDisconnects[1]).toHaveBeenCalledOnce();
    } finally {
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('preserves a reentrant restart triggered while old observers disconnect', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    let reenter = false;
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });

    class ReentrantMutationObserver implements MutationObserver {
      disconnect(): void {
        if (reenter) {
          reenter = false;
          observer.start(document.documentElement);
        }
      }
      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    class CapturingIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
      }
      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    globalThis.MutationObserver = ReentrantMutationObserver;
    globalThis.IntersectionObserver = CapturingIntersectionObserver;
    try {
      observer.start(document.body);
      reenter = true;
      observer.stop();
      const callback = intersectionCallbacks.at(-1);
      if (callback === undefined) throw new Error('latest observer callback missing');
      const element = document.createElement('p');
      callback(
        [{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(observer.isVisible(element)).toBe(true);
    } finally {
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('does not let an outer restart supersede a start triggered during disconnect', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const mutationCallbacks: MutationCallback[] = [];
    const intersectionCallbacks: IntersectionObserverCallback[] = [];
    const mutationDisconnects: ReturnType<typeof vi.fn>[] = [];
    const intersectionDisconnects: ReturnType<typeof vi.fn>[] = [];
    let reenter = false;
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });

    class ReentrantMutationObserver implements MutationObserver {
      readonly disconnect = vi.fn(() => {
        if (reenter) {
          reenter = false;
          observer.start(document.documentElement);
        }
      });
      constructor(callback: MutationCallback) {
        mutationCallbacks.push(callback);
        mutationDisconnects.push(this.disconnect);
      }
      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    class CapturingIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      readonly disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        intersectionCallbacks.push(callback);
        intersectionDisconnects.push(this.disconnect);
      }
      observe(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    globalThis.MutationObserver = ReentrantMutationObserver;
    globalThis.IntersectionObserver = CapturingIntersectionObserver;
    try {
      observer.start(document.body);
      reenter = true;
      observer.start(document.body);

      expect(mutationCallbacks).toHaveLength(2);
      expect(intersectionCallbacks).toHaveLength(2);
      expect(mutationDisconnects[0]).toHaveBeenCalledOnce();
      expect(mutationDisconnects[1]).not.toHaveBeenCalled();
      expect(intersectionDisconnects[0]).toHaveBeenCalledOnce();
      expect(intersectionDisconnects[1]).not.toHaveBeenCalled();

      const element = document.createElement('p');
      intersectionCallbacks[0]?.(
        [{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(observer.isVisible(element)).toBe(false);
      intersectionCallbacks[1]?.(
        [{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      expect(observer.isVisible(element)).toBe(true);
    } finally {
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('attempts both old observer disconnects when the first cleanup throws', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalIntersectionObserver = globalThis.IntersectionObserver;
    const intersectionDisconnect = vi.fn();
    class ThrowingMutationObserver implements MutationObserver {
      disconnect(): void {
        throw new Error('mutation cleanup failed');
      }
      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    class TrackingIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [];
      readonly disconnect = intersectionDisconnect;
      observe(): void {}
      unobserve(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    globalThis.MutationObserver = ThrowingMutationObserver;
    globalThis.IntersectionObserver = TrackingIntersectionObserver;
    const observer = new ObserverManager({
      onStructuralChange: () => {},
      onVisibilityChange: () => {},
    });
    observer.start(document.body);

    try {
      expect(() => observer.stop()).toThrow('mutation cleanup failed');
      expect(intersectionDisconnect).toHaveBeenCalledOnce();
    } finally {
      globalThis.MutationObserver = originalMutationObserver;
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('detects added bindings without relying on a global Node constructor', () => {
    const originalMutationObserver = globalThis.MutationObserver;
    const originalNode = globalThis.Node;
    let mutationCallback: MutationCallback | undefined;

    class CapturingMutationObserver implements MutationObserver {
      constructor(callback: MutationCallback) {
        mutationCallback = callback;
      }

      disconnect(): void {}
      observe(): void {}
      takeRecords(): MutationRecord[] {
        return [];
      }
    }

    globalThis.MutationObserver = CapturingMutationObserver;
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    const wrapper = document.createElement('section');
    wrapper.innerHTML = '<p data-payload-field="nested">value</p>';

    try {
      observer.start(document.body);
      Reflect.deleteProperty(globalThis, 'Node');
      if (mutationCallback === undefined) throw new Error('mutation callback was not captured');
      mutationCallback(
        [
          {
            type: 'childList',
            addedNodes: [wrapper],
            removedNodes: [],
          } as unknown as MutationRecord,
        ],
        {} as MutationObserver,
      );
      vi.advanceTimersByTime(10);

      expect(onStructuralChange).toHaveBeenCalledOnce();
    } finally {
      globalThis.Node = originalNode;
      observer.stop();
      globalThis.MutationObserver = originalMutationObserver;
    }
  });

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
