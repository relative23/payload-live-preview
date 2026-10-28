import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import { UpdateScheduler } from '@core/update-scheduler';
import type { CachedElement } from '@core/types';
import { fireMessage, IO, textRenderer, TRUSTED } from './lifecycle-harness';

/**
 * The visibility gate holds a write until its element scrolls into view, on a
 * page with more bindings than `visibilityGateThreshold` (50). An empty-field
 * anchor (`data-payload-boundary`, `PreviewBoundary`) is `hidden` while its
 * field is empty, and a hidden element never intersects the viewport: measured
 * on a site with 57 bindings, a button label emptied and typed again stayed
 * away for the 20 s of the run, and arrived in 51 ms with the gate off. The
 * write is the only thing that can show the anchor, so an anchor with nothing
 * to scroll to is written at once; every other binding keeps the gate.
 */

let runtime: LivePreviewRuntime | undefined;

function post(data: Record<string, unknown>): void {
  fireMessage({ type: 'payload-live-preview', data });
}
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(50);
}
/** Sixty plain bindings put the page over the default threshold of 50. */
function crowdedPage(anchor: string): HTMLElement | null {
  const fields = Array.from(
    { length: 60 },
    (_, index) => `<p data-payload-field="f${String(index)}">f${String(index)}</p>`,
  );
  document.body.innerHTML = anchor + fields.join('');
  return document.querySelector<HTMLElement>('[data-payload-field="label"]');
}
function start(): LivePreviewRuntime {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer() },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter: new EventEmitter(),
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    enableA11y: false,
    warn: () => {},
  });
  runtime.start();
  return runtime;
}

afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
  document.body.innerHTML = '';
});

describe('an empty-field anchor under the visibility gate', () => {
  it('shows a field that was empty when the page loaded once it is typed', async () => {
    const anchor = crowdedPage(
      '<button><span data-payload-field="label" data-payload-boundary hidden></span></button>',
    )!;
    const rt = start();
    post({ label: '' });
    await settle();
    expect(rt.inspect().scheduler.visibilityGateActive).toBe(true);

    post({ label: 'Book a table' });
    await settle();

    expect(anchor.hasAttribute('hidden')).toBe(false);
    expect(anchor.textContent).toBe('Book a table');
  });

  it('shows a field that was emptied and typed again', async () => {
    const anchor = crowdedPage(
      '<button><span data-payload-field="label" data-payload-boundary>Book</span></button>',
    )!;
    start();
    // On screen while it shows its words; a hidden element intersects nothing.
    IO.latest?.setVisible(anchor, true);
    post({ label: 'Book' });
    await settle();
    post({ label: '' });
    await settle();
    expect(anchor.hasAttribute('hidden')).toBe(true);
    IO.latest?.setVisible(anchor, false);

    post({ label: 'Book now' });
    await settle();

    expect(anchor.hasAttribute('hidden')).toBe(false);
    expect(anchor.textContent).toBe('Book now');
  });

  it('still holds an ordinary binding the reader has not scrolled to', async () => {
    crowdedPage('');
    const rt = start();
    post({ f59: 'f59' });
    await settle();

    post({ f59: 'changed below the fold' });
    await settle();

    expect(document.querySelector('[data-payload-field="f59"]')?.textContent).toBe('f59');
    expect(rt.inspect().scheduler.deferred).toBeGreaterThan(0);
  });
});

/** One write to an anchor the viewport has not reported, on a page over the threshold. */
function flushAnchor(box: DOMRect, attributes: { hidden?: boolean; anchor?: boolean } = {}) {
  const apply = vi.fn();
  const scheduler = new UpdateScheduler(apply, {
    debounceMs: 0,
    isVisible: () => false,
    getCacheSize: () => 100,
    visibilityGateThreshold: 50,
    scheduleFrame: (callback) => {
      callback(0);
      return 1;
    },
    cancelFrame: () => {},
  });
  const element = document.createElement('p');
  element.hidden = attributes.hidden === true;
  element.getBoundingClientRect = () => box;
  document.body.append(element);
  const target: CachedElement = {
    element,
    fieldName: 'note',
    fieldType: 'text',
    ...(attributes.anchor === false ? {} : { hidesWhenEmpty: true }),
  };
  scheduler.schedule({ target, value: 'typed', allFields: {} });
  scheduler.flushNow();
  return { apply, scheduler };
}

describe('UpdateScheduler — the gate and an empty-field anchor', () => {
  it('holds an anchor that is shown and has a size until it is seen', () => {
    const { apply, scheduler } = flushAnchor(new DOMRect(0, 4000, 300, 24));
    expect(apply).not.toHaveBeenCalled();
    expect(scheduler.replayCount).toBe(1);
  });

  it('writes a hidden anchor at once, whatever box it reports', () => {
    const { apply, scheduler } = flushAnchor(new DOMRect(0, 4000, 300, 24), { hidden: true });
    expect(apply).toHaveBeenCalledOnce();
    expect(scheduler.replayCount).toBe(0);
  });

  it.each([
    ['no height', new DOMRect(0, 4000, 300, 0)],
    ['no width', new DOMRect(0, 4000, 0, 24)],
  ])('writes an anchor with %s at once', (_label, box) => {
    const { apply } = flushAnchor(box);
    expect(apply).toHaveBeenCalledOnce();
  });

  it('holds an ordinary binding with no size, which is not an anchor', () => {
    const { apply } = flushAnchor(new DOMRect(0, 4000, 0, 0), { anchor: false, hidden: true });
    expect(apply).not.toHaveBeenCalled();
  });
});
