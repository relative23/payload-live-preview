import { describe, expect, it, vi } from 'vitest';
import { BINDING_ATTRIBUTES } from '@core/cache';
import { ObserverManager } from '@core/observers';
import { flushMutations } from './observers-harness';

// The table `it.each` iterates has to be visible in this file: the test
// policy resolves it statically.
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
  'data-payload-owner',
  'data-payload-depends',
  'data-payload-strategy',
  'data-payload-boundary',
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
  it('rebuilds when an owner changes on an ancestor that is not itself a binding', async () => {
    const root = document.body;
    const shell = document.createElement('section');
    shell.setAttribute('data-payload-owner', 'global:homepage');
    const tracked = document.createElement('p');
    tracked.setAttribute('data-payload-field', 'title');
    shell.appendChild(tracked);
    root.appendChild(shell);
    const onStructuralChange = vi.fn();
    const observer = new ObserverManager(
      { onStructuralChange, onVisibilityChange: () => {} },
      { mutationDebounceMs: 10 },
    );
    observer.start(root);

    // The owner re-attributes every binding below it, so a change here must
    // rebuild even though the mutated element carries no field attribute.
    shell.setAttribute('data-payload-owner', 'global:services-page');
    await flushMutations();
    vi.advanceTimersByTime(10);

    expect(onStructuralChange).toHaveBeenCalledOnce();
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
