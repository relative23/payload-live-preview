import { describe, expect, it, vi } from 'vitest';
import { ObserverManager } from '@core/observers';
import { getLatestStub } from './observers-harness';

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
