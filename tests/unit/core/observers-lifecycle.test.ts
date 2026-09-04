import { describe, expect, it, vi } from 'vitest';
import { ObserverManager } from '@core/observers';
// Imported for its hooks: fake timers and the IntersectionObserver stub.
import './observers-harness';

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
