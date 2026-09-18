import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from '@events/emitter';
import { LivePreviewRuntime } from '@core/lifecycle';
import type { FieldRenderer } from '@core/types';

/**
 * A field with no binding says one of two things, by the value it came with:
 * empty, and the template most likely renders the anchor only while the field
 * is non-empty (LP0201); a value, and the page does not show this field, which
 * a page that renders a subset of the document does on purpose (LP0203). The
 * demo printed six LP0201 lines with anchor advice for fields it never meant
 * to bind; the advice was wrong for every one of them.
 */

class IO implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const TRUSTED = 'https://admin.example.com';
let emitter: EventEmitter;
let runtime: LivePreviewRuntime | undefined;
let warnings: string[];
const textRenderer: FieldRenderer = {
  name: 'text',
  render(target, value) {
    target.element.textContent = String(value);
  },
};

function post(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'payload-live-preview', data },
      origin: TRUSTED,
    }),
  );
}
function afterUpdate(): Promise<void> {
  return new Promise((resolve) => {
    emitter.once('afterUpdate', () => {
      resolve();
    });
  });
}
function start(): void {
  runtime = new LivePreviewRuntime({
    renderers: { text: textRenderer },
    originMatcher: (origin) => origin === TRUSTED,
    readyTargets: [TRUSTED],
    emitter,
    debounceMs: 0,
    heartbeatMs: 10 * 60_000,
    disableVisibilityGate: true,
    enableA11y: false,
    warn: (...args: unknown[]) => {
      warnings.push(String(args[0]));
    },
  });
  runtime.start();
}
const lines = (code: string): string[] => warnings.filter((line) => line.includes(code));

beforeEach(() => {
  globalThis.IntersectionObserver = IO;
  emitter = new EventEmitter();
  warnings = [];
  document.body.innerHTML = '<h1 data-payload-field="title">old</h1>';
  start();
});
afterEach(() => {
  runtime?.destroy();
  runtime = undefined;
});

describe('a field with no binding', () => {
  it('with a value is LP0203: the page does not show it, and the line says where that is visible', async () => {
    const done = afterUpdate();
    post({ title: 'new', slug: 'about' });
    await done;
    expect(lines('LP0203')).toHaveLength(1);
    expect(lines('LP0203')[0]).toContain(
      'field "slug" has a value and no <… data-payload-field="slug">',
    );
    expect(lines('LP0203')[0]).toContain('inspect().fidelity.fields');
    expect(lines('LP0203')[0]).toContain('onUnfaithfulPatch decides');
    expect(lines('LP0201')).toHaveLength(0);
    expect(runtime?.inspect().bindings.orphanFields).toEqual(['slug']);
  });

  it('that is empty is LP0201: the anchor advice applies', async () => {
    const done = afterUpdate();
    post({ title: 'new', teaser: '' });
    await done;
    expect(lines('LP0201')).toHaveLength(1);
    expect(lines('LP0201')[0]).toContain('the empty field "teaser"');
    expect(lines('LP0201')[0]).toContain('render the anchor unconditionally');
    expect(lines('LP0203')).toHaveLength(0);
  });

  it('is said once per field, whichever code it was', async () => {
    const first = afterUpdate();
    post({ title: 'a', slug: 'x', teaser: '' });
    await first;
    const second = afterUpdate();
    post({ title: 'b', slug: 'y', teaser: '' });
    await second;
    expect(lines('LP0203')).toHaveLength(1);
    expect(lines('LP0201')).toHaveLength(1);
    expect(runtime?.inspect().bindings.orphanFields).toEqual(['slug', 'teaser']);
  });

  it('inside a group names the scalar, by the same rule', async () => {
    const done = afterUpdate();
    post({ title: 'new', meta: { title: 'Meta', description: '' } });
    await done;
    expect(lines('LP0203')[0]).toContain('field "meta.title"');
    expect(lines('LP0201')[0]).toContain('the empty field "meta.description"');
  });
});
