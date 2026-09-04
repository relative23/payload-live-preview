import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { TRUSTED, deferred, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — flush accounting and replay', () => {
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
});
