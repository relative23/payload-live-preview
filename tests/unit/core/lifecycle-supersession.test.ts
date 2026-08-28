import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { TRUSTED, deferred, fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — supersession and re-entrancy', () => {
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
});
