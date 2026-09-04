import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';
import { fireMessage, flushMicrotasks, textRenderer } from './lifecycle-harness';

describe('LivePreviewRuntime — cache refresh — retargeting buffered work', () => {
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
